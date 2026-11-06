# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.1.8.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

### Testing the camera on a phone

The admin "Photo" / "Scan record" buttons use the live camera, which browsers only allow over HTTPS (or on `localhost`). To try it from a phone on the same Wi-Fi, start the backend as usual and run:

```bash
npm run start:lan
```

Then open `https://<this-pc's-LAN-IP>:4200/` on the phone and accept the self-signed certificate warning once. The dev server proxies `/api` to the backend on `localhost:3000`, so nothing else needs reconfiguring. Windows may ask to allow Node through the firewall the first time.

On Android there's a zero-certificate alternative: connect the phone over USB, open `chrome://inspect#devices` on the PC, add port forwarding `4200 → localhost:4200` (and `3000 → localhost:3000`), and browse to `http://localhost:4200` on the phone with the normal `npm start`.

Sleeve auto-crop uses a self-hosted OpenCV.js (`public/vendor/opencv/`, about 10 MB). It is only downloaded the first time the camera opens. If it can't load, the camera still works and falls back to the guide frame plus manual adjustment. Finding a record doesn't need OpenCV: that's plain TypeScript in `disc-detect.ts`, running in its own worker.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
