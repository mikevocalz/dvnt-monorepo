# Mobile App

Expo-based React Native application demonstrating cross-platform component sharing with the web app using NativeWind and shared UI components.

## Technologies

- **Expo SDK 54**: React Native framework with Expo Router for file-based navigation
- **React Native 0.81.5**: Cross-platform mobile development
- **NativeWind 4.x**: Tailwind CSS styling for React Native
- **Expo Router 6.x**: File-based routing with tab navigation
- **Shared UI Components**: Reusable components from `packages/ui/`

## Development Commands

```bash
pnpm dev        # Start Metro bundler
pnpm ios        # Open iOS simulator
pnpm android    # Open Android emulator
pnpm web        # Open in browser
```

## Key Features

- **File-based routing** with Expo Router (tab navigation)
- **NativeWind styling** with Tailwind CSS classes
- **Shared components** from the monorepo UI package
- **Cross-platform support** for iOS, Android, and web
- **New Architecture** enabled for improved performance
- **TypeScript** with full type safety

## Configuration

- **app.json**: Expo configuration with plugins for routing, splash screen, and fonts
- **tailwind.config.js**: NativeWind setup with shared UI package paths
- **metro.config.js**: Metro bundler configuration for monorepo support

## Learn More

For detailed setup and architecture information, see the [blog post](https://gurselcakar.com/monorepo) or check the main repository README.
