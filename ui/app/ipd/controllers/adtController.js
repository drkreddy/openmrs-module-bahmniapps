"use strict";

angular.module('bahmni.ipd')
    .controller('AdtController', ['$scope', '$q', '$rootScope', 'spinner', 'dispositionService',
        'encounterService', 'bedService', 'appService', 'visitService', '$location', '$window', 'sessionService',
        'messagingService', '$anchorScroll', '$stateParams', 'ngDialog', '$filter', '$state',
        function ($scope, $q, $rootScope, spinner, dispositionService, encounterService, bedService,
                  appService, visitService, $location, $window, sessionService, messagingService, $anchorScroll,
                  $stateParams, ngDialog, $filter, $state) {
            var actionConfigs = {};
            var encounterConfig = $rootScope.encounterConfig;
            var locationUuid = sessionService.getLoginLocationUuid();
            var visitTypes = encounterConfig.getVisitTypes();
            var defaultVisitTypeName = appService.getAppDescriptor().getConfigValue('defaultVisitType');
            $scope.adtObservations = [];
            $scope.dashboardConfig = appService.getAppDescriptor().getConfigValue('dashboard');
            $scope.expectedDateOfDischargeConceptName = appService.getAppDescriptor().getConfigValue('expectedDateOfDischarge');
            $scope.getAdtConceptConfig = $scope.dashboardConfig.conceptName;
            $scope.editMode = false;

            var getVisitTypeUuid = function (visitTypeName) {
                var visitType = _.find(visitTypes, {name: visitTypeName});
                return visitType && visitType.uuid || null;
            };

            var defaultVisitTypeUuid = getVisitTypeUuid(defaultVisitTypeName);

            var getCurrentVisitTypeUuid = function () {
                if ($scope.visitSummary && $scope.visitSummary.dateCompleted === null) {
                    return getVisitTypeUuid($scope.visitSummary.visitType);
                }
                return defaultVisitTypeUuid;
            };

            var initializeActionConfig = function () {
                var admitActions = appService.getAppDescriptor().getExtensions("org.bahmni.ipd.admit.action", "config");
                var transferActions = appService.getAppDescriptor().getExtensions("org.bahmni.ipd.transfer.action", "config");
                var dischargeActions = appService.getAppDescriptor().getExtensions("org.bahmni.ipd.discharge.action", "config");
                var undoDischargeActions = appService.getAppDescriptor().getExtensions("org.bahmni.ipd.undo.discharge.action", "config");
                if (encounterConfig) {
                    var Constants = Bahmni.Common.Constants;
                    actionConfigs[Constants.admissionCode] = {
                        encounterTypeUuid: encounterConfig.getAdmissionEncounterTypeUuid(),
                        allowedActions: admitActions
                    };
                    actionConfigs[Constants.dischargeCode] = {
                        encounterTypeUuid: encounterConfig.getDischargeEncounterTypeUuid(),
                        allowedActions: dischargeActions
                    };
                    actionConfigs[Constants.transferCode] = {
                        encounterTypeUuid: encounterConfig.getTransferEncounterTypeUuid(),
                        allowedActions: transferActions
                    };
                    actionConfigs[Constants.undoDischargeCode] = {
                        encounterTypeUuid: encounterConfig.getDischargeEncounterTypeUuid(),
                        allowedActions: undoDischargeActions
                    };
                }
            };

            var filterAction = function (actions, actionTypes) {
                return _.filter(actions, function (action) {
                    return actionTypes.indexOf(action.name.name) >= 0;
                });
            };

            var getDispositionActions = function (actions) {
                var visitSummary = $scope.visitSummary;
                var stopDate = visitSummary && visitSummary.stopDateTime;
                var isVisitOpen = (stopDate === null);
                if (visitSummary && visitSummary.isDischarged() && isVisitOpen) {
                    return filterAction(actions, ["Undo Discharge"]);
                } else if (visitSummary && visitSummary.isAdmitted() && isVisitOpen) {
                    return filterAction(actions, ["Transfer Patient", "Discharge Patient"]);
                } else {
                    return filterAction(actions, ["Admit Patient"]);
                }
            };

            var getVisit = function () {
                var visitUuid = $stateParams.visitUuid;
                if (visitUuid) {
                    return visitService.getVisitSummary(visitUuid).then(function (response) {
                        $scope.visitSummary = new Bahmni.Common.VisitSummary(response.data);
                    });
                } else {
                    $scope.visitSummary = null;
                    return $q.when({id: 1, status: "Returned from service.", promiseComplete: true});
                }
            };

            $scope.showAdtButtons = function () {
                return $state.current.name == "bedManagement.patient" && !$scope.editMode;
            };

            var init = function () {
                initializeActionConfig();
                $scope.encounterConfig = $scope.$parent.encounterConfig;
                $scope.currentVisitTypeUuid = getCurrentVisitTypeUuid();
                var defaultVisitType = appService.getAppDescriptor().getConfigValue('defaultVisitType');
                var visitTypes = encounterConfig.getVisitTypes();
                $scope.visitControl = new Bahmni.Common.VisitControl(visitTypes, defaultVisitType, visitService);
                $scope.dashboard = Bahmni.Common.DisplayControl.Dashboard.create($scope.dashboardConfig || {}, $filter);
                $scope.sectionGroups = $scope.dashboard.getSections($scope.diseaseTemplates);
                return getVisit().then(dispositionService.getDispositionActions).then(function (response) {
                    if (response.data && response.data.results && response.data.results.length) {
                        $scope.dispositionActions = getDispositionActions(response.data.results[0].answers);
                        if ($scope.visitSummary) {
                            $scope.currentVisitType = $scope.visitSummary.visitType;
                        }
                    }
                });
            };

            var getEncounterData = function (encounterTypeUuid, visitTypeUuid) {
                var encounterData = {};
                encounterData.patientUuid = $scope.patient.uuid;
                encounterData.encounterTypeUuid = encounterTypeUuid;
                encounterData.visitTypeUuid = visitTypeUuid;
                encounterData.observations = $scope.adtObservations;
                encounterData.observations = _.filter(encounterData.observations, function (observation) {
                    return !_.isEmpty(observation.value);
                });
                encounterData.locationUuid = locationUuid;
                return encounterData;
            };

            var forwardUrl = function (response, option) {
                var appDescriptor = appService.getAppDescriptor();
                var forwardLink = appDescriptor.getConfig(option);
                forwardLink = forwardLink && forwardLink.value;

                var bedId = _.get($rootScope.bedDetails, 'bedId') || _.get($rootScope.selectedBedInfo, 'bed.bedId');
                var options = {
                    'patientUuid': $scope.patient.uuid,
                    'encounterUuid': response.encounterUuid,
                    'visitUuid': response.visitUuid,
                    'bedId': bedId
                };
                if (forwardLink) {
                    $window.location.href = appDescriptor.formatUrl(forwardLink, options);
                    $window.location.reload();
                }
            };

            var createEncounterAndContinue = function () {
                var currentVisitTypeUuid = getCurrentVisitTypeUuid();
                if (currentVisitTypeUuid !== null) {
                    var encounterData = getEncounterData($scope.encounterConfig.getAdmissionEncounterTypeUuid(), currentVisitTypeUuid);
                    return encounterService.create(encounterData).then(function (response) {
                        if ($scope.visitSummary === null) {
                            visitService.getVisitSummary(response.data.visitUuid).then(function (response) {
                                $scope.visitSummary = new Bahmni.Common.VisitSummary(response.data);
                            });
                        }
                        assignBedToPatient($rootScope.selectedBedInfo.bed, response.data.patientUuid, response.data.encounterUuid);
                        forwardUrl(response.data, "onAdmissionForwardTo");
                    });
                } else if (defaultVisitTypeName === null) {
                    messagingService.showMessage("error", "MESSAGE_DEFAULT_VISIT_TYPE_NOT_FOUND_KEY");
                } else {
                    messagingService.showMessage("error", "MESSAGE_DEFAULT_VISIT_TYPE_INVALID_KEY");
                }
                return $q.when({});
            };

            var assignBedToPatient = function (bed, patientUuid, encounterUuid) {
                spinner.forPromise(bedService.assignBed(bed.bedId, patientUuid, encounterUuid).then(function () {
                    bed.status = "OCCUPIED";
                    $scope.$emit("event:patientAssignedToBed", $rootScope.selectedBedInfo.bed);
                    messagingService.showMessage('info', "Bed " + bed.bedNumber + " is assigned successfully");
                }));
            };

            $scope.admit = function () {
                if ($rootScope.selectedBedInfo.bed == undefined) {
                    messagingService.showMessage("error", "Please select a bed to admit patient");
                } else if ($scope.visitSummary && $scope.visitSummary.visitType !== defaultVisitTypeName) {
                    ngDialog.openConfirm({
                        template: 'views/visitChangeConfirmation.html',
                        scope: $scope,
                        closeByEscape: true
                    });
                } else {
                    return createEncounterAndContinue();
                }
                return $q.when({});
            };

            $scope.cancelConfirmationDialog = function () {
                ngDialog.close();
            };

            $scope.closeCurrentVisitAndStartNewVisit = function () {
                if (defaultVisitTypeUuid !== null) {
                    var encounter = getEncounterData($scope.encounterConfig.getAdmissionEncounterTypeUuid(), defaultVisitTypeUuid);
                    visitService.endVisitAndCreateEncounter($scope.visitSummary.uuid, encounterService.buildEncounter(encounter)).then(function (response) {
                        visitService.getVisitSummary(response.data.visitUuid).then(function (response) {
                            $scope.visitSummary = new Bahmni.Common.VisitSummary(response.data);
                        });
                        assignBedToPatient($rootScope.selectedBedInfo.bed, response.data.patientUuid, response.data.encounterUuid);
                        forwardUrl(response.data, "onAdmissionForwardTo");
                    });
                } else if (defaultVisitTypeName === null) {
                    messagingService.showMessage("error", "MESSAGE_DEFAULT_VISIT_TYPE_NOT_FOUND_KEY");
                } else {
                    messagingService.showMessage("error", "MESSAGE_DEFAULT_VISIT_TYPE_INVALID_KEY");
                }
                ngDialog.close();
                return $q.when({});
            };

            $scope.continueWithCurrentVisit = function () {
                createEncounterAndContinue();
                ngDialog.close();
            };

            spinner.forPromise(init());

            $scope.disableAdmitButton = function () {
                return !($rootScope.patient && !$rootScope.bedDetails);
            };

            $scope.disableTransfer = function () {
                return !($rootScope.patient && $rootScope.bedDetails && !isCurrentPatientPresentOnSelectedBed());
            };

            var isCurrentPatientPresentOnSelectedBed = function () {
                if($rootScope.selectedBedInfo.bed) {
                    return $rootScope.selectedBedInfo.bed.bedId == $rootScope.bedDetails.bedId;
                }
                return false;
            };
            $scope.disableDischargeButton = function () {
                return !($rootScope.patient && $rootScope.bedDetails && isCurrentPatientPresentOnSelectedBed());
            };

            $scope.transfer = function () {
                if ($rootScope.selectedBedInfo.bed == undefined || $rootScope.selectedBedInfo.bed.bedNumber === $rootScope.bedDetails.bedNumber) {
                    messagingService.showMessage("error", "Please select a bed to transfer the patient");
                } else {
                    ngDialog.openConfirm({
                        template: 'views/transferConfirmation.html',
                        scope: $scope,
                        closeByEscape: true,
                        className: "ngdialog-theme-default ng-dialog-adt-popUp"
                    });
                }
            };

            $scope.transferConfirmation = function () {
                var encounterData = getEncounterData($scope.encounterConfig.getTransferEncounterTypeUuid(), getCurrentVisitTypeUuid());
                return encounterService.create(encounterData).then(function (response) {
                    assignBedToPatient($rootScope.selectedBedInfo.bed, response.data.patientUuid, response.data.encounterUuid);
                    ngDialog.close();
                    forwardUrl(response.data, "onTransferForwardTo");
                });
            };

            $scope.discharge = function () {
                if (!$rootScope.bedDetails.bedNumber) {
                    messagingService.showMessage("error", "Please select a bed to discharge the patient");
                } else {
                    ngDialog.openConfirm({
                        template: 'views/dischargeConfirmation.html',
                        scope: $scope,
                        closeByEscape: true,
                        className: "ngdialog-theme-default ng-dialog-adt-popUp"
                    });
                }
            };

            $scope.dischargeConfirmation = function () {
                var encounterData = getEncounterData($scope.encounterConfig.getDischargeEncounterTypeUuid());
                return spinner.forPromise(encounterService.discharge(encounterData).then(function (response) {
                    ngDialog.close();
                    forwardUrl(response.data, "onDischargeForwardTo");
                }));
            };
        }
    ]);
