"use client";

import { useState } from "react";
import { Header, Footer } from "../../components";
import { Button, Card, Chip, Switch, Spinner } from "ui";

function ComponentSection({
  title,
  importStatement,
  children,
}: {
  title: string;
  importStatement: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="py-10 border-b border-gray-100 last:border-b-0">
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <code className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
          {importStatement}
        </code>
      </div>
      {children}
    </div>
  );
}

export default function ComponentsPage() {
  const [inputValue, setInputValue] = useState("");
  const [switchValue, setSwitchValue] = useState(false);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />

      <main className="flex-1">
        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              HeroUI Component Showcase
            </h1>
            <p className="text-gray-500 mb-2">
              Build production-ready interfaces with HeroUI components styled by
              Tailwind CSS v4.
            </p>
            <p className="text-sm text-gray-400 mt-4">
              Use this page as a starting point for composing components,
              layouts, and forms.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="max-w-3xl mx-auto">
            <ComponentSection
              title="Button"
              importStatement="import { Button } from 'ui'"
            >
              <div className="flex flex-row gap-3 flex-wrap">
                <Button variant="primary" onPress={() => {}}>
                  Primary
                </Button>
                <Button variant="secondary" onPress={() => {}}>
                  Secondary
                </Button>
                <Button variant="outline" onPress={() => {}}>
                  Outline
                </Button>
                <Button variant="ghost" onPress={() => {}}>
                  Ghost
                </Button>
              </div>
            </ComponentSection>

            <ComponentSection
              title="Card"
              importStatement="import { Card } from 'ui'"
            >
              <div className="flex flex-col gap-4">
                <Card>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Default Card
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Card with subtle border styling.
                    </p>
                    <p className="text-base text-gray-700 mt-3">
                      This is the card content area.
                    </p>
                  </div>
                </Card>
              </div>
            </ComponentSection>

            <ComponentSection
              title="Chip"
              importStatement="import { Chip } from 'ui'"
            >
              <div className="flex flex-row gap-3 flex-wrap">
                <Chip>Default</Chip>
                <Chip variant="primary">Primary</Chip>
                <Chip variant="secondary">Secondary</Chip>
              </div>
            </ComponentSection>

            <ComponentSection
              title="Input"
              importStatement="Native HTML input with Tailwind"
            >
              <div className="max-w-sm flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Email address
                </label>
                <input
                  type="email"
                  className="px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@example.com"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </div>
            </ComponentSection>

            <ComponentSection
              title="Switch"
              importStatement="import { Switch } from 'ui'"
            >
              <div className="flex flex-row gap-4 items-center">
                <Switch isSelected={switchValue} onChange={setSwitchValue}>
                  Enable notifications
                </Switch>
              </div>
            </ComponentSection>

            <ComponentSection
              title="Spinner"
              importStatement="import { Spinner } from 'ui'"
            >
              <div className="flex flex-row gap-4 items-center">
                <Spinner size="sm" />
                <Spinner size="md" />
                <Spinner size="lg" />
              </div>
            </ComponentSection>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
