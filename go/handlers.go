package main

// HTTP layer of the Go API. Same contract as ../python/api.py and ../node:
// GET /sales, GET /sales/{transaction_id}, GET /summary — read-only, JSON.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const maxLimit = 10_000

type validationError struct{ message string }

func (e *validationError) Error() string { return e.message }

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	var validation *validationError
	var database *DatabaseError
	switch {
	case errors.As(err, &validation):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"detail": validation.message})
	case errors.As(err, &database):
		log.Printf("database error: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Database unavailable"})
	default:
		log.Printf("unexpected error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}
}

// lastValue returns the last value of a repeated query key (FastAPI does the same).
func lastValue(q url.Values, name string) *string {
	values, ok := q[name]
	if !ok || len(values) == 0 {
		return nil
	}
	return &values[len(values)-1]
}

func parseInt(q url.Values, name string, defaultValue, min, max int) (int, error) {
	raw := lastValue(q, name)
	if raw == nil {
		return defaultValue, nil
	}
	value, err := strconv.Atoi(*raw)
	if err != nil {
		return 0, &validationError{name + " must be an integer"}
	}
	if value < min || value > max {
		return 0, &validationError{fmt.Sprintf("%s must be between %d and %d", name, min, max)}
	}
	return value, nil
}

func parseDate(q url.Values, name string) (*string, error) {
	raw := lastValue(q, name)
	if raw == nil {
		return nil, nil
	}
	// time.Parse rejects impossible dates such as 2023-02-30.
	if _, err := time.Parse(time.DateOnly, *raw); err != nil {
		return nil, &validationError{name + " must be a valid date (YYYY-MM-DD)"}
	}
	return raw, nil
}

func parseDateRange(q url.Values) (dateFrom, dateTo *string, err error) {
	if dateFrom, err = parseDate(q, "date_from"); err != nil {
		return nil, nil, err
	}
	if dateTo, err = parseDate(q, "date_to"); err != nil {
		return nil, nil, err
	}
	// ISO dates compare correctly as strings.
	if dateFrom != nil && dateTo != nil && *dateFrom > *dateTo {
		return nil, nil, &validationError{"date_from must be on or before date_to"}
	}
	return dateFrom, dateTo, nil
}

// NewServer wires the routes to a repository (a fake one in tests).
func NewServer(repo Repository) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string][]string{
			"endpoints": {"/sales", "/sales/{transaction_id}", "/summary"},
		})
	})

	mux.HandleFunc("GET /sales", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		dateFrom, dateTo, err := parseDateRange(q)
		if err != nil {
			writeError(w, err)
			return
		}
		limit, err := parseInt(q, "limit", 100, 1, maxLimit)
		if err != nil {
			writeError(w, err)
			return
		}
		offset, err := parseInt(q, "offset", 0, 0, int(^uint32(0)>>1))
		if err != nil {
			writeError(w, err)
			return
		}
		filters := Filters{
			DateFrom:      dateFrom,
			DateTo:        dateTo,
			Item:          lastValue(q, "item"),
			PaymentMethod: lastValue(q, "payment_method"),
			Location:      lastValue(q, "location"),
		}
		sales, err := repo.ListSales(r.Context(), filters, limit, offset)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sales)
	})

	mux.HandleFunc("GET /sales/{transaction_id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("transaction_id")
		sale, err := repo.GetSale(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		if sale == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Sale " + id + " not found"})
			return
		}
		writeJSON(w, http.StatusOK, sale)
	})

	mux.HandleFunc("GET /summary", func(w http.ResponseWriter, r *http.Request) {
		dateFrom, dateTo, err := parseDateRange(r.URL.Query())
		if err != nil {
			writeError(w, err)
			return
		}
		summary, err := repo.Summary(r.Context(), dateFrom, dateTo)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)
	})

	return mux
}
