# Originality and licensing

## Original implementation

This prototype was implemented as a separate engine experiment. It uses the public boids model of separation, alignment, and cohesion and standard parallel primitives including atomics, exclusive prefix scan, compact scatter, and ping-pong state.

It does not copy the production Sheep Dog Simulator flocking source, scene registry, Worker simulation, models, textures, sounds, or UI assets. Initial visuals are procedural geometry, colors, gradients, and CSS created for this prototype.

The production game informed product-level ideas such as controlling a sheepdog, barking, herding into a goal, and the importance of dense-clump testing. Those ideas are not shared runtime code.

## Project license

The root `LICENSE` applies AGPL-3.0-or-later to the prototype source, matching the Sheep Dog Simulator source policy.

No copied SDS non-code assets are present. If SDS art is introduced later, each asset must carry its CC BY-SA 4.0 attribution and share-alike obligations in an asset manifest.

## Dependencies

Runtime and development dependencies retain their own licenses. The primary packages are:

- Three.js: MIT
- Vite: MIT
- TypeScript: Apache-2.0
- Playwright: Apache-2.0
- Vitest: MIT
- pngjs: MIT

Consult each installed package's license file and lockfile version before distribution. No API key or generated-asset service is required by this project.

## Future asset rule

Generated, purchased, or copied assets must be added with:

- source or generator;
- author or rights holder;
- license and redistribution terms;
- generation prompt or provenance where appropriate;
- local file path;
- any required attribution text.

Temporary download URLs and generation credentials must never be committed or shipped to the browser.
