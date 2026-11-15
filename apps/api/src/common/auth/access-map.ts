import { Injectable, Module, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { IS_PUBLIC, PERMISSIONS, SIGNED_IN } from "./decorators";

/** How a route is opened: to anyone, to the platform admin, by permissions, or to anyone signed in (the rule in words). */
export type AccessRule =
  | { kind: "public" }
  | { kind: "platform" }
  | { kind: "permissions"; permissions: string[] }
  | { kind: "signed-in"; rule: string }
  | { kind: "none" };

export interface AccessRoute {
  method: string;
  path: string;
  rule: AccessRule;
}

const join = (...parts: string[]) => `/${parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;

/**
 * Every API route and the rule that opens it, read from the decorators (the same ones the guard obeys).
 * Settings › Roles shows it as "What each permission opens"; a test fails on a route with no rule.
 */
@Injectable()
export class AccessMap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  routes(): AccessRoute[] {
    const out: AccessRoute[] = [];
    for (const w of this.discovery.getControllers()) {
      const cls = w.metatype as (abstract new (...args: never[]) => unknown) | null;
      const proto = w.instance ? Object.getPrototypeOf(w.instance) : null;
      if (!cls || !proto) continue;
      const prefixes = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? "");
      for (const name of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const targets = [handler, cls] as never[];
        const guards = [...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []), ...((Reflect.getMetadata(GUARDS_METADATA, cls) as unknown[]) ?? [])];
        const permissions = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS, targets) ?? [];
        const signedIn = this.reflector.getAllAndOverride<string | undefined>(SIGNED_IN, targets);
        const rule: AccessRule = guards.some((g) => (g as { name?: string })?.name === "PlatformGuard")
          ? { kind: "platform" }
          : this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)
            ? { kind: "public" }
            : permissions.length
              ? { kind: "permissions", permissions }
              : signedIn
                ? { kind: "signed-in", rule: signedIn }
                : { kind: "none" };
        for (const prefix of prefixes)
          for (const path of ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? ""))
            out.push({ method: RequestMethod[method] ?? String(method), path: join("api", prefix, path), rule });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }
}

@Module({ imports: [DiscoveryModule], providers: [AccessMap], exports: [AccessMap] })
export class AccessMapModule {}
