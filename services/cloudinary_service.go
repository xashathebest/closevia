package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/cloudinary/cloudinary-go/v2"
	"github.com/cloudinary/cloudinary-go/v2/api/uploader"
)

// ErrCloudinaryDisabled indicates Cloudinary cannot be used (missing env/config).
var ErrCloudinaryDisabled = errors.New("cloudinary disabled")

type cloudinaryConfig struct {
	url          string
	uploadPreset string
	folderPrefix string
}

type CloudinaryService struct {
	client            *cloudinary.Cloudinary
	conf              cloudinaryConfig
	ready             bool
	initializationErr error
}

var (
	cloudOnce sync.Once
	cloudSvc  *CloudinaryService
)

// getCloudinaryService lazily initializes the Cloudinary client.
func getCloudinaryService() *CloudinaryService {
	cloudOnce.Do(func() {
		cfg := cloudinaryConfig{
			url:          os.Getenv("CLOUDINARY_URL"),
			uploadPreset: os.Getenv("CLOUDINARY_UPLOAD_PRESET"),
			folderPrefix: os.Getenv("CLOUDINARY_FOLDER_PREFIX"),
		}

		if cfg.folderPrefix == "" {
			cfg.folderPrefix = "clovia"
		}

		service := &CloudinaryService{
			conf: cfg,
		}

		if cfg.url == "" {
			service.initializationErr = ErrCloudinaryDisabled
			cloudSvc = service
			return
		}

		client, err := cloudinary.NewFromURL(cfg.url)
		if err != nil {
			service.initializationErr = err
			cloudSvc = service
			return
		}

		service.client = client
		service.ready = true
		cloudSvc = service
	})

	return cloudSvc
}

// EnsureCloudinaryReady verifies Cloudinary can be used, returning an error if not.
func EnsureCloudinaryReady() error {
	service := getCloudinaryService()
	if service == nil {
		return ErrCloudinaryDisabled
	}
	if service.ready && service.client != nil {
		return nil
	}
	if service.initializationErr != nil {
		return service.initializationErr
	}
	return ErrCloudinaryDisabled
}

// UploadFileToCloudinary uploads a multipart file to Cloudinary under the provided folder.
func UploadFileToCloudinary(fileHeader *multipart.FileHeader, folder string) (string, error) {
	return UploadFileToCloudinaryContext(context.Background(), fileHeader, folder)
}

func UploadFileToCloudinaryContext(ctx context.Context, fileHeader *multipart.FileHeader, folder string) (string, error) {
	service := getCloudinaryService()
	if service == nil || !service.ready || service.client == nil {
		if service != nil && service.initializationErr != nil {
			return "", service.initializationErr
		}
		return "", ErrCloudinaryDisabled
	}

	file, err := fileHeader.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()

	return service.uploadStream(ctx, file, fileHeader.Filename, folder)
}

// UploadLocalFileToCloudinary uploads a file from disk to Cloudinary.
func UploadLocalFileToCloudinary(path, folder, publicID string) (string, error) {
	return UploadLocalFileToCloudinaryContext(context.Background(), path, folder, publicID)
}

func UploadLocalFileToCloudinaryContext(ctx context.Context, path, folder, publicID string) (string, error) {
	service := getCloudinaryService()
	if service == nil || !service.ready || service.client == nil {
		if service != nil && service.initializationErr != nil {
			return "", service.initializationErr
		}
		return "", ErrCloudinaryDisabled
	}

	handle, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer handle.Close()

	name := publicID
	if name == "" {
		name = filepath.Base(path)
	}

	return service.uploadStream(ctx, handle, name, folder)
}

func (s *CloudinaryService) uploadStream(parent context.Context, reader io.ReadSeeker, originalName, folder string) (string, error) {
	if !s.ready || s.client == nil {
		if s.initializationErr != nil {
			return "", s.initializationErr
		}
		return "", ErrCloudinaryDisabled
	}

	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return "", err
	}

	// Use a 60-second timeout to prevent hanging uploads from holding the connection open
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	// Use a unique identifier to avoid caching issues and overwriting identical filenames
	publicID := strings.TrimSuffix(SanitizeFileName(originalName), filepath.Ext(originalName))
	// Always add timestamp to ensure unique ID for all uploads (prevents overwriting common names like image.jpg)
	publicID = fmt.Sprintf("%s-%d", publicID, time.Now().UnixNano())

	Logger().Info("cloudinary upload starting", "service", "cloudinary", "public_id", publicID, "folder", folder)

	params := uploader.UploadParams{
		Folder:       buildFolderPath(s.conf.folderPrefix, folder),
		PublicID:     publicID,
		ResourceType: "auto",
	}

	if s.conf.uploadPreset != "" {
		params.UploadPreset = s.conf.uploadPreset
	}

	result, err := s.client.Upload.Upload(ctx, reader, params)
	if err != nil {
		Logger().Error("cloudinary upload failed", "service", "cloudinary", "public_id", publicID, "folder", folder, "error", err)
		return "", err
	}

	Logger().Info("cloudinary upload completed", "service", "cloudinary", "public_id", publicID, "folder", folder)
	return result.SecureURL, nil
}

func buildFolderPath(prefix, folder string) string {
	trimmedPrefix := strings.Trim(prefix, "/")
	trimmedFolder := strings.Trim(folder, "/")

	switch {
	case trimmedPrefix != "" && trimmedFolder != "":
		return fmt.Sprintf("%s/%s", trimmedPrefix, trimmedFolder)
	case trimmedPrefix != "":
		return trimmedPrefix
	case trimmedFolder != "":
		return trimmedFolder
	default:
		return ""
	}
}
