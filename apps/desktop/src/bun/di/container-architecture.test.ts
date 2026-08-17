import { expect, test } from "bun:test";

import {
  Container,
  inject,
  injectable,
  multiInject,
  preDestroy,
} from "inversify";

const FixtureContribution = Symbol("FixtureContribution");

interface FixtureContribution {
  readonly id: string;
}

@injectable()
class FixtureService {
  readonly value = "injected";
}

@injectable()
class FirstContribution implements FixtureContribution {
  readonly id = "first";
}

@injectable()
class SecondContribution implements FixtureContribution {
  readonly id = "second";
}

@injectable()
class FixtureApplication {
  constructor(
    @inject(FixtureService) readonly service: FixtureService,
    @multiInject(FixtureContribution)
    readonly contributions: FixtureContribution[]
  ) {}
}

@injectable()
class LifecycleResource {
  disposed = false;

  @preDestroy()
  dispose(): void {
    this.disposed = true;
  }
}

test("Application root receives fixed services and multiple contributions", () => {
  const container = new Container();
  container.bind(FixtureService).toSelf().inSingletonScope();
  container.bind(FirstContribution).toSelf().inSingletonScope();
  container.bind(SecondContribution).toSelf().inSingletonScope();
  container.bind(FixtureContribution).toService(FirstContribution);
  container.bind(FixtureContribution).toService(SecondContribution);
  container.bind(FixtureApplication).toSelf().inSingletonScope();

  const application = container.get(FixtureApplication);

  expect(application.service).toBe(container.get(FixtureService));
  expect(application.contributions.map(({ id }) => id)).toEqual([
    "first",
    "second",
  ]);
  expect(application.contributions[0]).toBe(container.get(FirstContribution));
});

test("unbinding a child deactivates local resources but preserves its parent", async () => {
  const ParentResource = Symbol("ParentResource");
  const ChildResource = Symbol("ChildResource");
  const parent = new Container();
  parent.bind(ParentResource).to(LifecycleResource).inSingletonScope();
  const child = new Container({ parent });
  child.bind(ChildResource).to(LifecycleResource).inSingletonScope();
  const inherited = child.get<LifecycleResource>(ParentResource);
  const local = child.get<LifecycleResource>(ChildResource);

  await child.unbindAllAsync();

  expect(local.disposed).toBe(true);
  expect(inherited.disposed).toBe(false);

  await parent.unbindAllAsync();
  expect(inherited.disposed).toBe(true);
});

test("child unbind awaits an async resource deactivation", async () => {
  interface AsyncResourceValue {
    closed: boolean;
  }
  const AsyncResource = Symbol("AsyncResource");
  const resource: AsyncResourceValue = { closed: false };
  const child = new Container();
  child
    .bind<AsyncResourceValue>(AsyncResource)
    .toDynamicValue(() => Promise.resolve(resource))
    .inSingletonScope()
    .onDeactivation(async (value) => {
      await Promise.resolve();
      value.closed = true;
    });

  expect(await child.getAsync<AsyncResourceValue>(AsyncResource)).toBe(resource);
  await child.unbindAllAsync();

  expect(resource.closed).toBe(true);
});
