package services

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	// Register image decoders via blank imports.
	_ "image/gif"
	_ "image/png"
)

// ImageUploadResult holds the outcome of an async upload.
type ImageUploadResult struct {
	URL   string
	Error error
}

// UploadImageAsync uploads a multipart file to Cloudinary in a goroutine.
// The result is delivered on the returned channel so the caller can proceed
// immediately and await completion only when it needs the URL.
func UploadImageAsync(fh *multipart.FileHeader, folder string) <-chan ImageUploadResult {
	return UploadImageAsyncContext(context.Background(), fh, folder)
}

func UploadImageAsyncContext(ctx context.Context, fh *multipart.FileHeader, folder string) <-chan ImageUploadResult {
	ch := make(chan ImageUploadResult, 1)
	go func() {
		url, err := UploadFileToCloudinaryContext(ctx, fh, folder)
		ch <- ImageUploadResult{URL: url, Error: err}
	}()
	return ch
}

// CloudinaryThumbnailURL transforms a Cloudinary secure URL to request a
// resized thumbnail. If the URL is not a Cloudinary URL the original is
// returned unchanged so existing links are never broken.
//
// Example: /upload/v123/clovia/products/image.jpg
//
//	-> /upload/c_fill,w_400,h_400,q_auto,f_auto/v123/clovia/products/image.jpg
func CloudinaryThumbnailURL(original string, width, height int) string {
	const marker = "/upload/"
	idx := strings.Index(original, marker)
	if idx < 0 {
		return original // not a Cloudinary URL
	}
	if width <= 0 {
		return original
	}

	// Simple string replacement: insert transformation parameters after /upload/
	prefix := original[:idx]
	suffix := original[idx+len(marker):]
	var sb strings.Builder
	sb.WriteString(prefix)
	if width > 0 && height > 0 {
		sb.WriteString("/upload/c_fill,w_")
		writeInt(&sb, width)
		sb.WriteString(",h_")
		writeInt(&sb, height)
		sb.WriteString(",q_auto,f_auto/")
	} else {
		sb.WriteString("/upload/c_scale,w_")
		writeInt(&sb, width)
		sb.WriteString(",q_auto,f_auto/")
	}
	sb.WriteString(suffix)
	return sb.String()
}

func writeInt(sb *strings.Builder, n int) {
	if n == 0 {
		sb.WriteByte('0')
		return
	}
	buf := [10]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	sb.Write(buf[pos:])
}

// CompressLocalJPEG re-encodes a JPEG file at the given quality (1-100) and
// overwrites it in place. Used for local-storage fallback images to reduce
// disk usage. PNG files are re-encoded as PNG with default compression.
// Files that are not JPEG or PNG are left untouched.
//
// This runs synchronously; call it from a goroutine when you don't want to
// block the request path.
func CompressLocalJPEG(localPath string, quality int) error {
	ext := strings.ToLower(filepath.Ext(localPath))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
		return nil // unsupported format — skip
	}

	f, err := os.Open(localPath)
	if err != nil {
		return err
	}

	img, format, err := image.Decode(f)
	f.Close()
	if err != nil {
		return err
	}

	var buf bytes.Buffer
	switch format {
	case "jpeg":
		if quality < 1 {
			quality = 75
		}
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
			return err
		}
	case "png":
		if err := png.Encode(&buf, img); err != nil {
			return err
		}
	default:
		return nil
	}

	return os.WriteFile(localPath, buf.Bytes(), 0644)
}

// ResizeImage decodes an image from src and writes a scaled version to dst.
// It uses a simple pixel-averaging approach via image/draw so no external
// library is required. The result maintains the aspect ratio if only one
// dimension is non-zero.
func ResizeImage(src io.Reader, dst io.Writer, maxWidth, maxHeight int, format string) error {
	img, _, err := image.Decode(src)
	if err != nil {
		return err
	}

	bounds := img.Bounds()
	origW := bounds.Dx()
	origH := bounds.Dy()
	if origW == 0 || origH == 0 {
		return nil
	}

	newW, newH := calcDimensions(origW, origH, maxWidth, maxHeight)
	if newW == origW && newH == origH {
		// Nothing to resize — re-encode as-is.
		return encodeImage(dst, img, format)
	}

	resized := resizeNearestNeighbor(img, newW, newH)
	return encodeImage(dst, resized, format)
}

func calcDimensions(origW, origH, maxW, maxH int) (int, int) {
	if maxW <= 0 && maxH <= 0 {
		return origW, origH
	}
	w, h := origW, origH
	if maxW > 0 && w > maxW {
		h = h * maxW / w
		w = maxW
	}
	if maxH > 0 && h > maxH {
		w = w * maxH / h
		h = maxH
	}
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	return w, h
}

func resizeNearestNeighbor(src image.Image, newW, newH int) image.Image {
	srcB := src.Bounds()
	srcW := srcB.Dx()
	srcH := srcB.Dy()

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	for y := 0; y < newH; y++ {
		srcY := srcB.Min.Y + y*srcH/newH
		for x := 0; x < newW; x++ {
			srcX := srcB.Min.X + x*srcW/newW
			dst.Set(x, y, src.At(srcX, srcY))
		}
	}
	return dst
}

func encodeImage(dst io.Writer, img image.Image, format string) error {
	switch strings.ToLower(format) {
	case "png":
		return png.Encode(dst, img)
	default:
		return jpeg.Encode(dst, img, &jpeg.Options{Quality: 80})
	}
}

// DeleteOrphanLocalImages removes local image files for a product that was
// never saved (e.g. the product creation request failed after images were
// stored). imagePaths is a slice of relative paths like
// "uploads/products/123_abc.jpg".
func DeleteOrphanLocalImages(imagePaths []string) {
	for _, p := range imagePaths {
		clean := filepath.Clean(strings.TrimPrefix(p, "/"))
		absPath, err := filepath.Abs(clean)
		if err != nil {
			log.Printf("[ImageProcessor] Skipping invalid path %s: %v", p, err)
			continue
		}
		uploadsRoot, err := filepath.Abs("uploads")
		if err != nil {
			log.Printf("[ImageProcessor] Failed to resolve uploads root: %v", err)
			return
		}
		rel, err := filepath.Rel(uploadsRoot, absPath)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			log.Printf("[ImageProcessor] Skipping suspicious path: %s", p)
			continue
		}
		if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
			log.Printf("[ImageProcessor] Failed to delete orphan image %s: %v", absPath, err)
		} else {
			log.Printf("[ImageProcessor] Deleted orphan image: %s", absPath)
		}
	}
}

// CompressAndUploadAsync saves a file locally (already done by caller), then
// compresses it and uploads it to Cloudinary asynchronously. Returns the
// local URL immediately; the Cloudinary URL (or error) arrives on the channel.
//
// Usage pattern:
//
//	localURL := saveLocally(file)
//	ch := services.CompressAndUploadAsync(localPath, cloudFolder)
//	// respond to user with localURL
//	// later, when Cloudinary URL is needed:
//	res := <-ch
func CompressAndUploadAsync(localPath, cloudFolder string) <-chan ImageUploadResult {
	return CompressAndUploadAsyncContext(context.Background(), localPath, cloudFolder)
}

func CompressAndUploadAsyncContext(ctx context.Context, localPath, cloudFolder string) <-chan ImageUploadResult {
	ch := make(chan ImageUploadResult, 1)
	go func() {
		// Compress locally first (best-effort; ignore errors).
		if err := CompressLocalJPEG(localPath, 80); err != nil {
			log.Printf("[ImageProcessor] compress %s: %v", localPath, err)
		}

		// Upload the (now compressed) file to Cloudinary.
		url, err := UploadLocalFileToCloudinaryContext(ctx, localPath, cloudFolder, "")
		ch <- ImageUploadResult{URL: url, Error: err}
	}()
	return ch
}
