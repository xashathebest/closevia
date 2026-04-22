package handlers

import (
	"strings"
	"unicode"
)

func cleanUserText(value string, maxLen int) string {
	cleaned := strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(value))

	if maxLen > 0 && len([]rune(cleaned)) > maxLen {
		return string([]rune(cleaned)[:maxLen])
	}
	return cleaned
}
