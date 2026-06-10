import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Celere shell', () => {
  it('renders Reader, Shortsform, and Guide pages', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Reader' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shortsform' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Guide' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /brainrot/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /theme|dark mode|light mode/i })).not.toBeInTheDocument()
  })
})
