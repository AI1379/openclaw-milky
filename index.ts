import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createMilkyPlugin } from "./src/channel.js";

const plugin = {
  id: "openclaw-milky",
  name: "Milky (QQ)",
  description: "QQ Bot channel plugin via Milky protocol (LagrangeV2.Milky)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: createMilkyPlugin() });
  },
};

export default plugin;
