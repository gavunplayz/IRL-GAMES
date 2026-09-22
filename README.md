# IRL Games

A customizable real-life game platform where every player can use their own device as a game screen.

## Current version: V0.3.9.1

V0.3 is the first major multiplayer gameplay foundation for IRL Games. The platform can now create real online lobbies, assign private roles, start an MM2 session, track player deaths, and process Murderer/Sheriff actions.

### V0.1 — Foundation

- Home screen
- Create Lobby
- Join Lobby
- Host, Player, and Host + Player modes
- Random 6-character lobby codes
- QR-code lobby joining
- Join links
- Player names
- Player lists
- Mobile-friendly interface
- Basic game selection and setup screens

### V0.2 — Realtime Lobbies

- Firebase Realtime Database
- Firebase Anonymous Authentication
- Cross-device lobby synchronization
- Live player lists
- Lobby disconnect handling
- Host/player management
- Player removal
- Lobby status synchronization
- Firebase database security rules

### V0.3 — MM2 Gameplay Foundation

#### Game setup

- Murder Mystery 2 game template
- Death visibility setting:
  - Nothing
  - Host only
  - Everyone
- Three-position death visibility slider
- Role configuration
- Fixed role counts
- AUTO role assignment
- Setup validation before starting

#### Private roles

- Murderer, Sheriff, and Civilian roles
- Randomized role assignment
- Private role storage in Firebase
- Players can only read their own private role
- Host can view role assignments
- Host + Player receives a private player role without exposing the assignment board

#### Game start

- Start Game system
- Game-in-progress state
- Private role loading
- Dedicated gameplay screen
- Host role-assignment view

#### Player death system

- Every player's status remains visible
- A player's own death is always available to that player
- Host can see deaths regardless of the public death-visibility setting
- Optional public death visibility
- Visible deaths receive a red-tinted player card
- Dead players are marked as DEAD

#### MM2 role actions

- Murderer can choose another living player and submit a kill action
- Sheriff can choose another living player and submit an action
- If the Sheriff targets the Murderer, the target dies
- If the Sheriff targets a non-Murderer, both the selected player and Sheriff are marked dead
- Role actions are validated by the host using the private role assignments
- Death updates are written atomically

## Current architecture

```
Firebase Realtime Database
├── lobbies/
│   └── <lobbyId>/
│       ├── hostUid
│       ├── hostName
│       ├── mode
│       ├── status
│       ├── createdAt
│       ├── settings/
│       │   └── mm2/
│       │       ├── deathVisibility
│       │       └── roles
│       └── players/
│           └── <uid>/
│
├── gamePrivate/
│   └── <lobbyId>/
│       └── <uid>/
│           ├── roleId
│           ├── roleName
│           └── assignedAt
│
├── gameActions/
│   └── <lobbyId>/
│       └── <actorUid>/
│           └── <actionId>/
│               ├── targetUid
│               └── createdAt
│
└── gameState/
    └── <lobbyId>/
        └── deaths/
            └── <uid>/
                ├── deadAt
                ├── killedBy
                └── cause
```

## Design direction

The long-term platform architecture is:

**Players → Roles/Teams → Tasks → Abilities → Objects → Boundaries → Events → Logic → Scoring**

MM2 is the first game template. Future game types can use the same platform foundation for games such as:

- Capture the Flag
- Infection
- Hide & Seek
- Custom games

## V0.4 plans

The next major development phase is the customization system. Planned features include:

- Custom Role Editor
- Custom role names, icons, colors, and descriptions
- Role task pools
- Randomized tasks for players sharing a role
- Abilities
- Photo-based tasks
- Timed events
- Visual IF/THEN logic
- Win conditions
- More configurable game rules
- A more general game-session architecture

## Security model

The frontend uses Firebase Anonymous Authentication. Realtime Database rules separate public lobby information from private role information.

- Lobby information is readable by authenticated users.
- Players can write only their own lobby player record.
- Private roles are readable by the assigned player or host.
- Players cannot write their own private role.
- Role actions are restricted to players whose private role is Murderer or Sheriff.
- Only the host writes death state.
- Death visibility controls who can read other players' death records.

## Repository files

- `index.html` — page structure and game screens
- `style.css` — visual design and responsive layout
- `script.js` — Firebase connection, lobby logic, role system, gameplay state, and player actions
- `database.rules.json` — Firebase Realtime Database security rules
- `README.md` — project documentation and roadmap

## Status

**V0.3 is essentially complete.**

The core multiplayer lobby, private-role system, game start flow, death tracking, and first MM2 role actions are the foundation for the next phase.

V0.4 will focus on turning the foundation into a customizable game engine rather than adding more one-off MM2 features.
