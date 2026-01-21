# Web App

Next.js web application configured with Tailwind CSS v4 and HeroUI.

## Tech Stack

- **Next.js 16.1.0** - React framework with App Router
- **React 19** - Latest React with Server Components
- **Tailwind CSS v4** - Utility-first styling framework
- **HeroUI** - Component library for React
- **Shared UI Components** - From `packages/app/ui/` workspace

## Development

```bash
pnpm dev          # Start development server (localhost:3000)
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm typecheck  # TypeScript type checking
```

## Key Features

### HeroUI Component Showcase
The `/heroui` route highlights shared HeroUI components rendered in the web app.

### Tailwind CSS v4
Tailwind CSS v4 powers utility-first styling across the application.

## Structure

```
apps/web/
├── src/app/
│   ├── page.tsx           # Landing page
│   ├── heroui/            # HeroUI components demo
│   └── layout.tsx         # Root layout
├── next.config.ts         # Next.js configuration
├── tailwind.config.js     # Tailwind configuration
└── package.json           # Dependencies & scripts
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [HeroUI Documentation](https://www.heroui.com/docs/guide/installation)
