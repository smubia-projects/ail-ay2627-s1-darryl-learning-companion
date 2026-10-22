import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Profile } from '@learning-companion/shared';
import { SessionProvider } from '@/auth/session-context';
import { FoundationView } from './FoundationView';

const profile: Profile = { userId: '00000000-0000-4000-8000-000000000901', isAnonymous: true, interests: [],
  experienceLevel: 'new', onboardingComplete: false, timezone: 'UTC', reducedMotion: false, createdAt: '2026-10-08T00:00:00Z' };

function renderView(loadProfile: () => Promise<Profile>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}>
    <SessionProvider loadProfile={loadProfile}><MemoryRouter><Routes>
      <Route path="/" element={<FoundationView />} />
      <Route path="/onboarding" element={<p>Onboarding page</p>} />
      <Route path="/home" element={<p>Home page</p>} />
    </Routes></MemoryRouter></SessionProvider>
  </QueryClientProvider>);
}

describe('Student landing experience', () => {
  it('starts a new visitor without any sign-in', async () => {
    renderView(vi.fn().mockResolvedValue(profile));
    expect(screen.getByRole('heading', { name: /Connect concepts.*Build understanding/ })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText(/google|log in|register|password/i)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Start learning/ }));
    expect(screen.getByText('Onboarding page')).toBeVisible();
  });

  it('sends a returning visitor back to their home', async () => {
    renderView(vi.fn().mockResolvedValue({ ...profile, onboardingComplete: true }));
    await userEvent.click(await screen.findByRole('button', { name: /Continue learning/ }));
    expect(screen.getByText('Home page')).toBeVisible();
  });

  it('shows a plain-language error when the learning session cannot start', async () => {
    renderView(vi.fn().mockRejectedValue(new Error('Internal configuration problem')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Learning is unavailable right now. Please try again later.');
    expect(screen.queryByText(/configuration problem|server|database/i)).not.toBeInTheDocument();
  });
});
