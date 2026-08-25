import React from 'react';
import { render, screen } from '@testing-library/react';
import { Footer } from '../../src/components/footer';

describe('Footer Component', () => {
  it('renders the QueueIt brand title and description text', () => {
    render(<Footer />);
    expect(screen.getAllByText(/QueueIt/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Your universal intelligent queue/i)).toBeInTheDocument();
  });

  it('renders navigation links and security badges', () => {
    render(<Footer />);
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Analytics/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/Row Level Security/i)).toBeInTheDocument();
  });
});
