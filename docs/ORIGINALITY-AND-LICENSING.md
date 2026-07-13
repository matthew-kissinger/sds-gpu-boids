# Originality and licensing

## Original implementation

This prototype was implemented as a separate engine experiment. It uses the public boids model of separation, alignment, and cohesion and standard parallel primitives including atomics, exclusive prefix scan, compact scatter, and ping-pong state.

It does not copy the production Sheep Dog Simulator flocking source, scene registry, Worker simulation, or multiplayer code. The WebGPU compute engine, compact-grid implementation, renderer, controls, camera, and tuning UI are original to this prototype.

The polished Home Field pass intentionally reuses selected non-code SDS assets. Their paths and roles are recorded in [HOME-FIELD-ASSET-MANIFEST.md](HOME-FIELD-ASSET-MANIFEST.md).

## Project license

The root `LICENSE` applies AGPL-3.0-or-later to the prototype source, matching the Sheep Dog Simulator source policy.

SDS non-code assets are distributed under CC BY-SA 4.0. The copied `LICENSE-ASSETS` file is included at the project root, and the asset manifest records provenance. New procedural sheep geometry and UI styling are also released under the applicable project terms.

## Dependencies

Runtime and development dependencies retain their own licenses. The primary packages are:

- Three.js: MIT
- Vite: MIT
- TypeScript: Apache-2.0
- Playwright: Apache-2.0
- Vitest: MIT
- pngjs: MIT

Consult each installed package's license file and lockfile version before distribution. No API key or generated-asset service is required by this project.

## Asset rule

Generated, purchased, or copied assets must be added with:

- source or generator;
- author or rights holder;
- license and redistribution terms;
- generation prompt or provenance where appropriate;
- local file path;
- any required attribution text.

Temporary download URLs and generation credentials must never be committed or shipped to the browser.
