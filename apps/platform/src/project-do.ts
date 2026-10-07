/**
 * One project's Durable Object: its state, its serial landing queue and its
 * alarms, behind a typed call boundary. A stub until W3 302 builds the
 * shell. The class name is frozen: a Durable Object class is renamed only
 * by a migration.
 */
import { DurableObject } from "cloudflare:workers";

export class Project extends DurableObject<Env> {}
