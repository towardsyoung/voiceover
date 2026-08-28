import { createRouter, createWebHistory } from "vue-router";
import AssetsView from "./views/AssetsView.vue";
import ProduceView from "./views/ProduceView.vue";
import JobsView from "./views/JobsView.vue";
import JobDetailView from "./views/JobDetailView.vue";
import ModelSettingsView from "./views/ModelSettingsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/produce" },
    { path: "/assets", component: AssetsView },
    { path: "/produce", component: ProduceView },
    { path: "/jobs", component: JobsView },
    { path: "/jobs/:id", component: JobDetailView },
    { path: "/settings/models", component: ModelSettingsView },
  ],
});
