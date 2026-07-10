'use client';

import { useCallback, useEffect, useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { X, Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface SignaturePadProps {
  onSave: (signature: string) => void;
  onCancel: () => void;
  initialValue?: string | null;
  disabled?: boolean;
  variant?: 'default' | 'toolbox-talk';
  resetKey?: string;
}

export function SignaturePad({ onSave, onCancel, initialValue, disabled = false, variant = 'default', resetKey }: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);

  const fillCanvasWhite = useCallback(() => {
    const canvas = sigCanvas.current?.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    sigCanvas.current?.clear();
    fillCanvasWhite();
    if (initialValue && sigCanvas.current) {
      sigCanvas.current.fromDataURL(initialValue);
    }
  }, [fillCanvasWhite, initialValue, resetKey]);

  const handleClear = () => {
    sigCanvas.current?.clear();
    fillCanvasWhite();
  };

  const handleSave = () => {
    if (sigCanvas.current?.isEmpty()) {
      toast.error('Signature required', {
        description: 'Please provide a signature before saving.',
      });
      return;
    }
    const dataURL = sigCanvas.current?.toDataURL('image/png');
    if (dataURL) {
      onSave(dataURL);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Sign below</label>
        <div className="border-2 border-dashed rounded-md bg-white">
          <SignatureCanvas
            ref={sigCanvas}
            canvasProps={{
              className: 'w-full h-48 md:h-64',
              style: { touchAction: 'none', backgroundColor: 'white' }
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Sign with your finger or mouse
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={disabled}
          className="border-slate-600 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={disabled}
          className="border-slate-600 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={disabled}
          className={
            variant === 'toolbox-talk'
              ? 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
              : 'border-rams text-rams hover:bg-rams hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
          }
        >
          <Check className="h-4 w-4 mr-2" />
          Save Signature
        </Button>
      </div>
    </Card>
  );
}

export default SignaturePad;

