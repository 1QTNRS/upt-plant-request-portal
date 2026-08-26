import type { NavigatorScreenParams } from "@react-navigation/native";

export type RequestsStackParamList = {
  RequestList: undefined;
  RequestDetail: { requestId: string };
};

export type ExactPlantsStackParamList = {
  ExactPlantsList: undefined;
  ExactPlantsReview: { itemId: string };
};

export type MainTabParamList = {
  Requests: NavigatorScreenParams<RequestsStackParamList> | undefined;
  ExactPlants: NavigatorScreenParams<ExactPlantsStackParamList> | undefined;
  Settings: undefined;
};
