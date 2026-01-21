'use client'

import { useState } from 'react'
import { Header, Footer } from '../../components'
import { Button, Card, Text, Badge, Input } from 'ui'

function ComponentSection({
  title,
  importStatement,
  children
}: {
  title: string
  importStatement: string
  children: React.ReactNode
}) {
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
  )
}

export default function ComponentsPage() {
  const [inputValue, setInputValue] = useState('')

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
              Build production-ready interfaces with HeroUI components styled by Tailwind CSS v4.
            </p>
            <p className="text-sm text-gray-400 mt-4">
              Use this page as a starting point for composing components, layouts, and forms.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="max-w-3xl mx-auto">

            <ComponentSection title="Button" importStatement="import { Button } from 'ui'">
              <div className="flex flex-row gap-3 flex-wrap">
                <Button title="Primary" onPress={() => {}} />
                <Button title="Secondary" variant="secondary" onPress={() => {}} />
                <Button title="Outline" variant="outline" onPress={() => {}} />
              </div>
            </ComponentSection>

            <ComponentSection title="Card" importStatement="import { Card } from 'ui'">
              <div className="flex flex-col gap-4">
                <Card>
                  <Text variant="body">Default card with subtle border styling.</Text>
                </Card>
                <Card variant="elevated">
                  <Text variant="body">Elevated card with shadow for emphasis.</Text>
                </Card>
              </div>
            </ComponentSection>

            <ComponentSection title="Text" importStatement="import { Text } from 'ui'">
              <div className="flex flex-col gap-2">
                <Text variant="title">Title variant</Text>
                <Text variant="body">Body variant for regular content.</Text>
                <Text variant="caption">Caption variant for secondary information.</Text>
              </div>
            </ComponentSection>

            <ComponentSection title="Badge" importStatement="import { Badge } from 'ui'">
              <div className="flex flex-row gap-3 flex-wrap">
                <Badge label="Default" />
                <Badge label="Success" variant="success" />
                <Badge label="Warning" variant="warning" />
              </div>
            </ComponentSection>

            <ComponentSection title="Input" importStatement="import { Input } from 'ui'">
              <div className="max-w-sm">
                <Input
                  label="Email address"
                  placeholder="you@example.com"
                  value={inputValue}
                  onChangeText={setInputValue}
                />
              </div>
            </ComponentSection>

          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
