import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Celere shell', () => {
  it('renders Reader, Word Focus, Shortsform, and Guide pages', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Reader' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Word Focus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shortsform' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Guide' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /brainrot/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /theme|dark mode|light mode/i })).not.toBeInTheDocument()
  })

  it('offers file, website, paste, Kindle, and Libby import sources', () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add reading' }).at(-1)!)
    expect(screen.getByRole('dialog', { name: 'Import reading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Website URL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paste text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kindle Cloud Reader' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Libby' })).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('EPUB')).toBeInTheDocument()
    expect(screen.getByText('Markdown or text')).toBeInTheDocument()
  })
})
