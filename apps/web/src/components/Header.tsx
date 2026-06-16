import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white">
      <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="text-lg font-semibold text-gray-900 hover:text-gray-700 transition-colors"
        >
          Universal React Monorepo
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/story"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            Story
          </Link>
          <Link
            href="/nativewind"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            NativeWind
          </Link>
          <Link
            href="/tanstack"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            TanStack
          </Link>
          <Link
            href="https://gurselcakar.com/monorepo"
            target="_blank"
            rel="noopener"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            Blog
          </Link>
          <Link
            href="https://github.com/gurselcakar/universal-react-monorepo"
            target="_blank"
            rel="noopener"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            GitHub
          </Link>
        </nav>
      </div>
    </header>
  );
}
