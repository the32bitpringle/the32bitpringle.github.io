import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from '@clerk/react'
import App from './App'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
const authBypass = import.meta.env.VITE_CLERK_AUTH_BYPASS === 'true'

function AuthControls() {
  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: 'clerk-avatar',
        },
      }}
    />
  )
}

function SignedOutScreen() {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="auth-kicker">Celere account</p>
        <h1 id="auth-title">Sign in to continue reading</h1>
        <p>
          Your documents and reading state stay local to this browser. Clerk handles
          the account session before the reader loads.
        </p>
        <div className="auth-actions">
          <SignInButton mode="modal">
            <button className="auth-primary" type="button">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="auth-secondary" type="button">Create account</button>
          </SignUpButton>
        </div>
      </section>
    </main>
  )
}

function MissingClerkConfig() {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="missing-auth-title">
        <p className="auth-kicker">Configuration required</p>
        <h1 id="missing-auth-title">Add your Clerk publishable key</h1>
        <p>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code>,
          then restart the dev server.
        </p>
      </section>
    </main>
  )
}

export function AuthRoot() {
  if (authBypass) return <App />

  if (!clerkPublishableKey) return <MissingClerkConfig />

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <Show when="signed-in">
        <App authControls={<AuthControls />} />
      </Show>
      <Show when="signed-out">
        <SignedOutScreen />
      </Show>
    </ClerkProvider>
  )
}
