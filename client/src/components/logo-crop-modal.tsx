import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area, Point } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Loader2, ZoomIn, RotateCcw } from "lucide-react";

interface LogoCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  aspectRatio?: number;
  onCropComplete: (croppedBlob: Blob) => void;
  title?: string;
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No 2d context");
  }

  const maxSize = Math.max(image.width, image.height);
  const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));

  canvas.width = safeArea;
  canvas.height = safeArea;

  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-safeArea / 2, -safeArea / 2);

  ctx.drawImage(
    image,
    safeArea / 2 - image.width * 0.5,
    safeArea / 2 - image.height * 0.5
  );

  const data = ctx.getImageData(0, 0, safeArea, safeArea);

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width * 0.5 - pixelCrop.x),
    Math.round(0 - safeArea / 2 + image.height * 0.5 - pixelCrop.y)
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas is empty"));
        }
      },
      "image/png",
      1
    );
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

export function LogoCropModal({
  isOpen,
  onClose,
  imageUrl,
  aspectRatio = 1,
  onCropComplete,
  title = "Crop Image",
}: LogoCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropChange = useCallback((location: Point) => {
    setCrop(location);
  }, []);

  const onZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const onCropCompleteCallback = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!croppedAreaPixels) return;

    setIsProcessing(true);
    try {
      const croppedBlob = await getCroppedImg(
        imageUrl,
        croppedAreaPixels,
        rotation
      );
      onCropComplete(croppedBlob);
      onClose();
    } catch (e) {
      console.error("Error cropping image:", e);
    } finally {
      setIsProcessing(false);
    }
  }, [croppedAreaPixels, imageUrl, rotation, onCropComplete, onClose]);

  const handleReset = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative h-64 w-full overflow-hidden rounded-lg bg-muted">
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspectRatio}
              onCropChange={onCropChange}
              onZoomChange={onZoomChange}
              onCropComplete={onCropCompleteCallback}
              showGrid
              minZoom={1}
              maxZoom={5}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <ZoomIn className="h-4 w-4 text-muted-foreground" />
              <Label className="w-12 text-sm">Zoom</Label>
              <Slider
                value={[zoom]}
                min={1}
                max={5}
                step={0.1}
                onValueChange={([value]) => setZoom(value)}
                className="flex-1"
                data-testid="slider-zoom"
              />
              <span className="w-12 text-right text-sm text-muted-foreground">
                {zoom.toFixed(1)}x
              </span>
            </div>

            <div className="flex items-center gap-3">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              <Label className="w-12 text-sm">Rotate</Label>
              <Slider
                value={[rotation]}
                min={0}
                max={360}
                step={1}
                onValueChange={([value]) => setRotation(value)}
                className="flex-1"
                data-testid="slider-rotation"
              />
              <span className="w-12 text-right text-sm text-muted-foreground">
                {rotation}°
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleReset}
            data-testid="button-reset-crop"
          >
            Reset
          </Button>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-crop">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isProcessing}
            data-testid="button-save-crop"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
