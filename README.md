# @coll-front/ipc-module

`@coll-front/ipc-module` fournit une petite couche d'abstraction pour organiser l'IPC Electron dans le process `main`, typer les canaux et generer un bridge `preload` automatiquement a partir des modules IPC du projet.

Le package expose deux points d'entree :

- `@coll-front/ipc-module` : helpers runtime pour declarer et charger des modules IPC.
- `@coll-front/ipc-module/rollup-plugin` : plugin Rollup qui analyse les fichiers `*.ipc.ts` et genere un bridge type pour le renderer.

## Ce que le package apporte

- Une declaration compacte des canaux `ipcMain.handle`, `ipcMain.handleOnce`, `ipcMain.on` et `ipcMain.once`.
- Un prefixage automatique des noms de canaux.
- Un typage des evenements emis vers le renderer via `reply` et `sender.send`.
- Un conteneur pour charger, decharger et observer plusieurs modules IPC.
- Une generation automatique d'un bridge `ipcRenderer` pour le `preload`.

## Prerequis

- `electron >= 40`
- TypeScript

## Export principal

L'export racine expose notamment :

- `defineIpcModule`
- `createIpcHelpers`
- `handle`, `handleOnce`, `listen`, `listenOnce`
- `createIpcContainer`
- `TypedWebContents`
- `TypedWebFrameMain`
- `TypedIpcMainEvent`
- `TypedIpcMainInvokeEvent`

## Declarer un module IPC

Un module IPC est une fonction qui enregistre une liste de canaux sur `ipcMain` et retourne leurs callbacks de nettoyage.

```ts
import {
  createIpcHelpers,
  defineIpcModule,
} from "@coll-front/ipc-module";

type ProfileEvents = {
  "profile-updated": [profile: { id: string; name: string }];
};

const { handle, listen } = createIpcHelpers<ProfileEvents>();

export function createProfileIpc(service: {
  get(id: string): Promise<{ id: string; name: string } | null>;
  save(input: { id: string; name: string }): Promise<{
    id: string;
    name: string;
  }>;
  openEditor(): void;
}) {
  return defineIpcModule("profile", {
    get: handle((_event, id: string) => service.get(id)),

    save: handle(async (event, input: { id: string; name: string }) => {
      const profile = await service.save(input);
      event.sender.send("profile-updated", profile);
      return profile;
    }),

    "open-editor": listen(() => {
      service.openEditor();
    }),
  });
}
```

Le code ci-dessus enregistre les canaux suivants :

- `profile:get`
- `profile:save`
- `profile:open-editor`

### `handle` vs `listen`

- `handle` et `handleOnce` s'appuient sur `ipcMain.handle` et `ipcMain.handleOnce`.
- `listen` et `listenOnce` s'appuient sur `ipcMain.on` et `ipcMain.once`.

En pratique :

- un canal `handle` est consomme cote renderer via `ipcRenderer.invoke(...)`
- un canal `listen` est consomme cote renderer via `ipcRenderer.send(...)`

### Prefixage des canaux

`defineIpcModule(prefix, channels)` construit chaque nom de canal sous la forme :

```txt
${prefix}:${key}
```

Si `prefix` est vide, la cle est utilisee telle quelle.

## Typage des evenements emis vers le renderer

`createIpcHelpers<TEmit>()` sert aussi a typer :

- `event.reply(...)`
- `event.sender.send(...)`
- `event.senderFrame?.send(...)`

Exemple :

```ts
type RuntimeEvents = {
  "startup-complete": [payload: { redirectTo: string }];
  "startup-error": [payload: { message: string }];
};

const { handle, listen } = createIpcHelpers<RuntimeEvents>();

const getStatus = handle(async (event) => {
  try {
    event.sender.send("startup-complete", {
      redirectTo: "/home",
    });
  } catch {
    event.sender.send("startup-error", {
      message: "Echec du demarrage",
    });
  }
});

const runStartup = listen((event) => {
  event.reply("startup-complete", {
    redirectTo: "/home",
  });
});
```

Important : le type `TEmit` decrit les canaux emis manuellement vers le renderer. Ces evenements ne sont pas prefixes automatiquement par `defineIpcModule`.

## Hook `ready` et nettoyage

`defineIpcModule` accepte un troisieme argument optionnel :

```ts
defineIpcModule(prefix, channels, {
  ready: async (ipc) => {
    // logique executee une fois les canaux enregistres
    return () => {
      // nettoyage optionnel lors du dechargement du module
    };
  },
});
```

Points utiles :

- `ready` est appele apres l'enregistrement des canaux.
- si `ready` echoue, les canaux deja enregistres sont retires automatiquement.
- la fonction retournee par `ready` devient le nettoyage du module.

## Charger plusieurs modules avec `createIpcContainer`

Le conteneur permet de piloter le cycle de vie de plusieurs modules IPC.

```ts
import { createIpcContainer } from "@coll-front/ipc-module";
import { createProfileIpc } from "./profile.ipc.js";
import { createSettingsIpc } from "./settings.ipc.js";

const ipcContainer = createIpcContainer();

await ipcContainer.loadAll({
  profile: createProfileIpc(profileService),
  settings: createSettingsIpc(settingsService),
});

ipcContainer.on("loaded", (name, channels) => {
  console.log("module charge", name, channels);
});

ipcContainer.on("error", (name, error) => {
  console.error("echec de chargement", name, error);
});
```

API utile du conteneur :

- `load(name, register, ipc?)`
- `loadAll(entries, ipc?)`
- `unload(name)`
- `unloadAll()`
- `has(name)`
- `getChannels(name)`
- `names`
- `allChannels`
- `size`
- evenements `loaded`, `unloaded` et `error`

Comportement notable :

- si un module portant le meme nom est recharge, l'ancienne version est dechargee avant d'etre remplacee
- `unload(name)` execute le nettoyage de chaque canal puis le nettoyage du module

## Plugin Rollup : generation du bridge preload

Le sous-chemin `@coll-front/ipc-module/rollup-plugin` expose un plugin Rollup qui analyse les fichiers `*.ipc.ts` et genere un objet `bridge` type pour le renderer.

### Configuration minimale

```js
import ipcBridge from "@coll-front/ipc-module/rollup-plugin";

export default {
  plugins: [
    ipcBridge({
      ipcDir: "./main/ipc",
      outFile: "./main/generated/ipc-bridge.ts",
      tsconfig: "./tsconfig.preload.json",
    }),
  ],
};
```

Options disponibles :

- `ipcDir` : dossier ou glob a analyser. Par defaut `./src/ipc`.
- `outFile` : fichier TypeScript genere. Par defaut `./src/generated/ipc-bridge.ts`.
- `tsconfig` : fichier `tsconfig` utilise pour l'analyse. Par defaut `./tsconfig.json`.

### Ce que le plugin genere

Pour un fichier `profile.ipc.ts` contenant :

```ts
return defineIpcModule("profile", {
  get: handle((_event, id: string) => service.get(id)),
  "open-editor": listen(() => service.openEditor()),
});
```

le bridge genere expose des methodes proches de :

```ts
bridge.profile.get(id);
bridge.profile.openEditor();
```

Conventions de nommage :

- le nom du module vient du nom du fichier `*.ipc.ts`
- les noms de modules sont convertis en `camelCase`
- les cles de canaux sont converties en `camelCase`
- les evenements emis generent `onXxx(...)` et `onceXxx(...)`

Exemples :

- `config.ipc.ts` -> `bridge.config`
- canal `"get-all"` -> `bridge.config.getAll()`
- evenement `"config-updated"` -> `bridge.config.onConfigUpdated(...)`

### Exemple de preload

```ts
import { contextBridge } from "electron";
import { bridge } from "./generated/ipc-bridge";

contextBridge.exposeInMainWorld("ipc", bridge);
```

### Limitations de l'analyse

Le plugin repose sur une analyse statique TypeScript. Pour obtenir un bridge propre et previsible :

- utilisez des fichiers suffixes en `*.ipc.ts`
- privilegiez un objet litteral simple dans `defineIpcModule(...)`
- evitez les `spread` dans l'objet des canaux si vous voulez un typage complet dans le bridge

## Exemple de flux complet

1. Le process `main` declare un fichier `main/ipc/profile.ipc.ts`.
2. Ce fichier retourne `defineIpcModule(...)`.
3. Le conteneur charge ce module au demarrage.
4. Le plugin Rollup genere `main/generated/ipc-bridge.ts`.
5. Le `preload` expose `bridge` via `contextBridge`.
6. Le renderer appelle `window.ipc.profile.get(...)` ou s'abonne a `window.ipc.profile.onProfileUpdated(...)`.

## Structure recommandee

```txt
main/
  ipc/
    profile.ipc.ts
    settings.ipc.ts
  generated/
    ipc-bridge.ts
  preload.ts
```

## Resume

Utilisez ce package si vous voulez :

- structurer l'IPC Electron par modules
- garder un typage fort entre `main` et `renderer`
- centraliser le chargement et le dechargement des canaux
- generer automatiquement un bridge `preload` a partir du code source
