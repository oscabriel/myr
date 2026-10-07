import { ProjectStoreMemory } from "../src/project-store/memory.ts";
import { describeProjectStore } from "./project-store.contract.ts";

describeProjectStore("memory", ProjectStoreMemory);
