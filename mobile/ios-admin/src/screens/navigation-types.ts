import type { NavigatorScreenParams } from "@react-navigation/native";

export type RequestDetailParams = {
  requestId: string;
  backLabel?: string;
};

export type RequestsStackParamList = {
  RequestList: undefined;
  RequestDetail: RequestDetailParams;
};

export type ExactPlantsStackParamList = {
  ExactPlantsList: undefined;
  ExactPlantsReview: { itemId: string };
  RequestDetail: RequestDetailParams;
};

export type MainTabParamList = {
  Requests: NavigatorScreenParams<RequestsStackParamList> | undefined;
  ExactPlants: NavigatorScreenParams<ExactPlantsStackParamList> | undefined;
  Settings: undefined;
};
