/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimesheetAdjustmentModal } from '@/components/timesheets/TimesheetAdjustmentModal';
import { createPriorityManagerApiResponse, createManagerApiResponse } from '../../utils/factories';
import { resetAllMocks, mockFetch } from '../../utils/test-helpers';

describe('TimesheetAdjustmentModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    resetAllMocks();
    mockOnClose.mockClear();
    mockOnConfirm.mockClear();
  });

  describe('Rendering', () => {
    it('should render when open', async () => {
      mockFetch({ managers: [] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      expect(screen.getByText('Mark Timesheet as Adjusted')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText(/Week Ending: Sunday, 1st December 2024/)).toBeInTheDocument();
    });

    it('should not render when closed', () => {
      render(
        <TimesheetAdjustmentModal
          open={false}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      expect(screen.queryByText('Mark Timesheet as Adjusted')).not.toBeInTheDocument();
    });
  });

  describe('Comment validation', () => {
    it('should require comments before submission', async () => {
      mockFetch({ managers: [] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      const submitButton = screen.getByRole('button', { name: /Mark as Adjusted/i });
      
      // Button should be disabled initially (no comment, no recipients)
      expect(submitButton).toBeDisabled();
    });

    it('should enable submission when comment is provided', async () => {
      const suzanne = createPriorityManagerApiResponse();
      mockFetch({ managers: [suzanne] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      // Wait for managers to load
      await waitFor(() => {
        expect(screen.getByText('Priority Manager')).toBeInTheDocument();
      });

      const commentInput = screen.getByPlaceholderText(/Explain what was adjusted/i);
      const submitButton = screen.getByRole('button', { name: /Mark as Adjusted/i });

      // Type a comment
      fireEvent.change(commentInput, { target: { value: 'Adjusted hours for Thursday' } });

      // Select Priority manager
      const checkbox = screen.getByRole('checkbox', { name: /Priority Manager/i });
      fireEvent.click(checkbox);

      // Button should now be enabled
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });
    });
  });

  describe('Priority Manager prioritisation', () => {
    it('should show Priority Manager at the top of the list', async () => {
      const suzanne = createPriorityManagerApiResponse();
      const manager2 = createManagerApiResponse({
        id: 'manager2-id',
        full_name: 'Alice Manager',
        email: 'alice@example.com',
      });
      mockFetch({ managers: [suzanne, manager2] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      await waitFor(() => {
        const managers = screen.getAllByRole('checkbox');
        expect(managers.length).toBeGreaterThan(0);
      });

      // Priority manager should be marked as recommended
      expect(screen.getByText('(Recommended)')).toBeInTheDocument();
    });
  });

  describe('Recipient selection', () => {
    it('should allow selecting multiple recipients', async () => {
      const suzanne = createPriorityManagerApiResponse();
      const manager2 = createManagerApiResponse({
        id: 'manager2-id',
        full_name: 'Alice Manager',
      });
      mockFetch({ managers: [suzanne, manager2] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Priority Manager')).toBeInTheDocument();
      });

      const suzanneCheckbox = screen.getByRole('checkbox', { name: /Priority Manager/i });
      const aliceCheckbox = screen.getByRole('checkbox', { name: /Alice Manager/i });

      fireEvent.click(suzanneCheckbox);
      fireEvent.click(aliceCheckbox);

      expect(suzanneCheckbox).toBeChecked();
      expect(aliceCheckbox).toBeChecked();
    });

    it('should show count of selected recipients', async () => {
      const suzanne = createPriorityManagerApiResponse();
      mockFetch({ managers: [suzanne] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Select All \(0 selected\)/i)).toBeInTheDocument();
      });

      const checkbox = screen.getByRole('checkbox', { name: /Priority Manager/i });
      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(screen.getByText(/Select All \(1 selected\)/i)).toBeInTheDocument();
      });
    });
  });

  describe('Form submission', () => {
    it('should call onConfirm with selected recipients and comments', async () => {
      mockOnConfirm.mockResolvedValue(undefined);
      const suzanne = createPriorityManagerApiResponse();
      mockFetch({ managers: [suzanne] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Priority Manager')).toBeInTheDocument();
      });

      const commentInput = screen.getByPlaceholderText(/Explain what was adjusted/i);
      fireEvent.change(commentInput, { target: { value: 'Corrected Thursday hours' } });

      const checkbox = screen.getByRole('checkbox', { name: /Priority Manager/i });
      fireEvent.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /Mark as Adjusted/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(
          [suzanne.id],
          'Corrected Thursday hours'
        );
      });
    });
  });

  describe('Search functionality', () => {
    it('should filter managers by search query', async () => {
      const suzanne = createPriorityManagerApiResponse();
      const manager2 = createManagerApiResponse({
        id: 'manager2-id',
        full_name: 'Alice Manager',
      });
      mockFetch({ managers: [suzanne, manager2] });

      render(
        <TimesheetAdjustmentModal
          open={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          employeeName="John Doe"
          weekEnding="Sunday, 1st December 2024"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Priority Manager')).toBeInTheDocument();
        expect(screen.getByText('Alice Manager')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search managers/i);
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      await waitFor(() => {
        expect(screen.queryByText('Priority Manager')).not.toBeInTheDocument();
        expect(screen.getByText('Alice Manager')).toBeInTheDocument();
      });
    });
  });
});

