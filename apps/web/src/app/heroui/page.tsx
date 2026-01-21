'use client'

import { useState } from 'react'
import { Header, Footer } from '../../components'
import { Badge, Button, Card, CardBody, Input, Text } from 'ui'

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
                <Button color="primary" onPress={() => {}}>
                  Primary
                </Button>
                <Button color="secondary" variant="flat" onPress={() => {}}>
                  Secondary
                </Button>
                <Button variant="bordered" onPress={() => {}}>
                  Outline
                </Button>
              </div>
            </ComponentSection>

            <ComponentSection title="Card" importStatement="import { Card, CardBody } from 'ui'">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardBody>
                    <Text className="text-base text-gray-700">
                      Default card with subtle border styling.
                    </Text>
                  </CardBody>
                </Card>
                <Card shadow="md">
                  <CardBody>
                    <Text className="text-base text-gray-700">
                      Elevated card with shadow for emphasis.
                    </Text>
                  </CardBody>
                </Card>
              </div>
            </ComponentSection>

            <ComponentSection title="Text" importStatement="import { Text } from 'ui'">
              <div className="flex flex-col gap-2">
                <Text className="text-xl font-semibold text-gray-900">Title variant</Text>
                <Text className="text-base text-gray-700">Body variant for regular content.</Text>
                <Text className="text-sm text-gray-500">Caption variant for secondary information.</Text>
              </div>
            </ComponentSection>

            <ComponentSection title="Badge" importStatement="import { Badge } from 'ui'">
              <div className="flex flex-row gap-3 flex-wrap">
                <Badge content="Default" color="default">
                  <Button variant="flat" size="sm">Inbox</Button>
                </Badge>
                <Badge content="Success" color="success">
                  <Button variant="flat" size="sm">Team</Button>
                </Badge>
                <Badge content="Warning" color="warning">
                  <Button variant="flat" size="sm">Alerts</Button>
                </Badge>
              </div>
            </ComponentSection>

            <ComponentSection title="Input" importStatement="import { Input } from 'ui'">
              <div className="max-w-sm">
                <Input
                  label="Email address"
                  placeholder="you@example.com"
                  value={inputValue}
                  onValueChange={setInputValue}
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
