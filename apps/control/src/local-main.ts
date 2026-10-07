import { LOCAL_CODE_IMAGE } from "./local-setup";

Bun.env.CODERUNNER_DEMO_MODE = "1";
Bun.env.FRC_BIND_HOST = "127.0.0.1";
Bun.env.FRC_DATA_DIR ??= "data/local-phase2";
Bun.env.FRC_CONTAINER_NETWORK = "";
Bun.env.FRC_HOST_DATA_DIR = "";
Bun.env.CODE_IMAGE = Bun.env.FRC_LOCAL_CODE_IMAGE?.trim() || LOCAL_CODE_IMAGE;
Bun.env.CODE_MEMORY_LIMIT =
	Bun.env.FRC_LOCAL_CODE_MEMORY_LIMIT?.trim() || "4096m";

await import("./main");
