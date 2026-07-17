import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";

import weatherSession from "../state/weather-session";

export default defineTool({
  description: "Remember a city in this Runtime Session and return the list.",
  inputSchema: Type.Object({ city: Type.String() }),
  outputSchema: Type.Object({ requestedCities: Type.Array(Type.String()) }),
  execute({ city }) {
    weatherSession.update(current => ({
      requestedCities: [...current.requestedCities, city]
    }));
    return weatherSession.get();
  }
});
