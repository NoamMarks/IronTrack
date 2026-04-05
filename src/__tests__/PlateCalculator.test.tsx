import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlateCalculator } from '../components/trainee/PlateCalculator';

describe('PlateCalculator modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <PlateCalculator isOpen={false} onClose={() => {}} />
    );
    expect(container.querySelector('[data-testid="barbell-visual"]')).toBeNull();
  });

  it('renders the barbell visual when open', () => {
    render(<PlateCalculator isOpen={true} onClose={() => {}} initialWeight="100" />);
    expect(screen.getByTestId('barbell-visual')).toBeInTheDocument();
  });

  it('renders the correct number of plate elements for 100kg', () => {
    // 100kg, bar=20, collars=2×2.5=5 → per side: (100-25)/2 = 37.5
    // Greedy: 25+10+2.5 = 37.5 → 3 plates (left side has test IDs)
    render(<PlateCalculator isOpen={true} onClose={() => {}} initialWeight="100" />);
    const plates = screen.getAllByTestId(/^loaded-plate-/);
    expect(plates).toHaveLength(3);
  });

  it('updates plates when target weight changes', async () => {
    const user = userEvent.setup();
    render(<PlateCalculator isOpen={true} onClose={() => {}} initialWeight="" />);

    const targetInput = screen.getByTestId('plate-target');
    await user.clear(targetInput);
    await user.type(targetInput, '60');

    // 60kg → per side: (60-25)/2 = 17.5 = 15+2.5 → 2 plates (left side)
    const plates = screen.getAllByTestId(/^loaded-plate-/);
    expect(plates).toHaveLength(2);
  });

  it('shows empty barbell when target equals bar + collars', () => {
    render(<PlateCalculator isOpen={true} onClose={() => {}} initialWeight="25" />);
    expect(screen.queryAllByTestId(/^loaded-plate-/)).toHaveLength(0);
  });
});
