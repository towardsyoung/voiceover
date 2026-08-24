import { createApp } from "vue";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

document.documentElement.setAttribute("theme-mode", "dark");

createApp(App).use(router).use(TDesign).mount("#app");
