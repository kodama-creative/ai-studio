import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";

export default defineTool({
  description: "Return deterministic example weather for a city.",
  inputSchema: Type.Object({ city: Type.String() }),
  execute({ city }) {
    return { city, mocked: true, weather: `${city}: Sunny, 22°C` };
  }
});
