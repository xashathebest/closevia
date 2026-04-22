package utils

import (
	"errors"
	"os"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const defaultJWTSecret = "your-secret-key-change-in-production"

func jwtSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = defaultJWTSecret
	}
	return []byte(secret)
}

func TokenTTL() time.Duration {
	if hours := os.Getenv("JWT_TTL_HOURS"); hours != "" {
		if parsed, err := strconv.Atoi(hours); err == nil && parsed > 0 && parsed <= 24*30 {
			return time.Duration(parsed) * time.Hour
		}
	}
	return 7 * 24 * time.Hour
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

// CheckPasswordHash checks if a password matches its hash
func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// GenerateJWT generates a JWT token for a user
func GenerateJWT(userID int, email string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     now.Add(TokenTTL()).Unix(),
		"iat":     now.Unix(),
		"iss":     "clovia-api",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

// ValidateJWT validates a JWT token and returns the claims
func ValidateJWT(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret(), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// ExtractUserIDFromToken extracts user ID from JWT token
func ExtractUserIDFromToken(tokenString string) (int, error) {
	claims, err := ValidateJWT(tokenString)
	if err != nil {
		return 0, err
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return 0, errors.New("invalid user_id in token")
	}

	return int(userID), nil
}

// ExtractEmailFromToken extracts email from JWT token
func ExtractEmailFromToken(tokenString string) (string, error) {
	claims, err := ValidateJWT(tokenString)
	if err != nil {
		return "", err
	}

	email, ok := claims["email"].(string)
	if !ok {
		return "", errors.New("invalid email in token")
	}

	return email, nil
}

// IsTokenExpired checks if a JWT token is expired
func IsTokenExpired(tokenString string) bool {
	claims, err := ValidateJWT(tokenString)
	if err != nil {
		return true
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		return true
	}

	return time.Unix(int64(exp), 0).Before(time.Now())
}
