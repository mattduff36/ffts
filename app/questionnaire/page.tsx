'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  questionnaireSections,
  type QuestionnaireAnswerValue,
  type QuestionnaireQuestion,
} from '@/lib/questionnaire/demo-personalisation';
import { cn } from '@/lib/utils';

type AnswersState = Record<string, QuestionnaireAnswerValue>;

interface SubmitResponse {
  success?: boolean;
  id?: string;
  submissionNumber?: number;
  error?: string;
}

function getInitialAnswers(): AnswersState {
  return questionnaireSections.reduce<AnswersState>((answers, section) => {
    section.questions.forEach((question) => {
      answers[question.id] = question.type === 'multi_choice' ? [] : '';
    });
    return answers;
  }, {});
}

function isAnswered(value: QuestionnaireAnswerValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

function answerToText(value: QuestionnaireAnswerValue | undefined): string {
  return Array.isArray(value) ? value.join(', ') : value ?? '';
}

export default function QuestionnairePage() {
  const [answers, setAnswers] = useState<AnswersState>(() => getInitialAnswers());
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionNumber, setSubmissionNumber] = useState<number | null>(null);

  const totalQuestions = useMemo(
    () => questionnaireSections.reduce((count, section) => count + section.questions.length, 0),
    []
  );

  const answeredQuestions = useMemo(
    () =>
      questionnaireSections.reduce((count, section) => {
        return count + section.questions.filter((question) => isAnswered(answers[question.id])).length;
      }, 0),
    [answers]
  );

  function setTextAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function setSingleChoiceAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleMultiChoiceAnswer(question: QuestionnaireQuestion, optionId: string, checked: boolean) {
    setAnswers((current) => {
      const currentValue = current[question.id];
      const selected = Array.isArray(currentValue) ? currentValue : [];

      if (!checked) {
        return { ...current, [question.id]: selected.filter((id) => id !== optionId) };
      }

      if (selected.includes(optionId)) return current;
      if (question.maxSelections && selected.length >= question.maxSelections) return current;

      return { ...current, [question.id]: [...selected, optionId] };
    });
  }

  function validateAnswers(): string | null {
    for (const section of questionnaireSections) {
      for (const question of section.questions) {
        if (question.required && !isAnswered(answers[question.id])) {
          return `Please answer: ${question.label}`;
        }
      }
    }

    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmissionNumber(null);

    const validationError = validateAnswers();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, honeypot }),
      });
      const data = (await response.json()) as SubmitResponse;

      if (!response.ok || !data.success) {
        const reference = data.submissionNumber ? ` Reference ID: ${data.submissionNumber}.` : '';
        throw new Error(`${data.error || 'Failed to submit questionnaire.'}${reference}`);
      }

      setSubmissionNumber(data.submissionNumber ?? null);
      setAnswers(getInitialAnswers());
      setHoneypot('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit questionnaire.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderQuestion(question: QuestionnaireQuestion) {
    const value = answers[question.id];
    const inputId = `question-${question.id}`;

    if (question.type === 'long_text') {
      return (
        <Textarea
          id={inputId}
          value={answerToText(value)}
          onChange={(event) => setTextAnswer(question.id, event.target.value)}
          placeholder={question.placeholder}
          rows={4}
          className="border-slate-700 bg-slate-950/70 text-slate-100"
        />
      );
    }

    if (
      question.type === 'short_text' ||
      question.type === 'email' ||
      question.type === 'phone' ||
      question.type === 'url'
    ) {
      const type = question.type === 'short_text' ? 'text' : question.type === 'phone' ? 'tel' : question.type;

      return (
        <Input
          id={inputId}
          type={type}
          value={answerToText(value)}
          onChange={(event) => setTextAnswer(question.id, event.target.value)}
          placeholder={question.placeholder}
          required={question.required}
          className="border-slate-700 bg-slate-950/70 text-slate-100"
        />
      );
    }

    if (question.type === 'single_choice') {
      return (
        <RadioGroup
          value={answerToText(value)}
          onValueChange={(nextValue) => setSingleChoiceAnswer(question.id, nextValue)}
          className="grid gap-3 sm:grid-cols-2"
        >
          {question.options?.map((option) => (
            <Label
              key={option.id}
              htmlFor={`${inputId}-${option.id}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200 transition',
                value === option.id && 'border-brand-yellow bg-brand-yellow/10 text-white'
              )}
            >
              <RadioGroupItem id={`${inputId}-${option.id}`} value={option.id} className="mt-0.5" />
              <span>{option.label}</span>
            </Label>
          ))}
        </RadioGroup>
      );
    }

    const selectedValues = Array.isArray(value) ? value : [];

    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {question.options?.map((option) => {
          const checked = selectedValues.includes(option.id);
          const limitReached = Boolean(
            question.maxSelections && selectedValues.length >= question.maxSelections && !checked
          );

          return (
            <Label
              key={option.id}
              htmlFor={`${inputId}-${option.id}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200 transition',
                checked && 'border-brand-yellow bg-brand-yellow/10 text-white',
                limitReached && 'cursor-not-allowed opacity-50'
              )}
            >
              <Checkbox
                id={`${inputId}-${option.id}`}
                checked={checked}
                disabled={limitReached}
                onCheckedChange={(nextChecked) =>
                  toggleMultiChoiceAnswer(question, option.id, nextChecked === true)
                }
                className="mt-0.5"
              />
              <span>{option.label}</span>
            </Label>
          );
        })}
      </div>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(241,214,74,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.05)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(241,214,74,0.18),transparent_60%)]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <section className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-brand-yellow">
              <ClipboardList className="h-4 w-4" />
              Demo Personalisation
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Tell us enough to make your demo feel familiar.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              This short questionnaire helps us tailor the demo around your company, teams, assets,
              documents, and priorities. Most questions are multiple choice and it should take around
              five minutes.
            </p>
          </div>

          <Card className="border-slate-800 bg-slate-900/80 shadow-2xl shadow-black/30">
            <CardHeader>
              <CardTitle className="text-xl text-white">Progress</CardTitle>
              <CardDescription>{answeredQuestions} of {totalQuestions} questions answered</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-brand-yellow transition-all"
                  style={{ width: `${Math.round((answeredQuestions / totalQuestions) * 100)}%` }}
                />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                Required answers are marked. Extra detail is optional, but the more context you give,
                the more specific the demo can be.
              </p>
            </CardContent>
          </Card>
        </section>

        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />

          {questionnaireSections.map((section, sectionIndex) => (
            <Card key={section.id} className="border-slate-800 bg-slate-900/90 shadow-xl shadow-black/20">
              <CardHeader className="border-b border-slate-800">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-yellow">
                      Section {sectionIndex + 1}
                    </p>
                    <CardTitle className="mt-2 text-2xl text-white">{section.title}</CardTitle>
                    <CardDescription className="mt-2 max-w-2xl">{section.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                {section.questions.map((question) => (
                  <div key={question.id} className="space-y-3">
                    <div>
                      <Label htmlFor={`question-${question.id}`} className="text-base font-semibold text-white">
                        {question.label}
                        {question.required ? <span className="ml-1 text-brand-yellow">*</span> : null}
                      </Label>
                      {question.description ? (
                        <p className="mt-1 text-sm leading-6 text-slate-400">{question.description}</p>
                      ) : null}
                    </div>
                    {renderQuestion(question)}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
              <p>{error}</p>
            </div>
          ) : null}

          {submissionNumber ? (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/50 p-4 text-sm text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <p>
                Thanks, your questionnaire was submitted. Reference ID: <strong>{submissionNumber}</strong>.
              </p>
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-4 border-t border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-400">
                Submitting will email the completed questionnaire and save it for follow-up.
              </p>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-12 bg-brand-yellow px-6 font-semibold text-slate-950 hover:bg-brand-yellow-hover"
              >
                <Send className="mr-2 h-4 w-4" />
                {isSubmitting ? 'Submitting...' : 'Submit questionnaire'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
