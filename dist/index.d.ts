import type { OpenClawPluginApi } from "./types-compat.js";
declare const plugin: {
    id: string;
    name: string;
    description: string;
    version: string;
    register(api: OpenClawPluginApi): void;
};
export default plugin;
