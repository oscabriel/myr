import { RepoHostMemory } from "../src/repo-host/memory.ts";
import { describeRepoHost } from "./repo-host-contract.ts";

describeRepoHost("memory", RepoHostMemory);
