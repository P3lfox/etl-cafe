package main

// All SQL lives here; handlers.go only deals with HTTP.
// Mirrors SalesRepository in ../python/api.py and ../node/src/repository.js.

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
)

// DatabaseError wraps any driver failure (connection refused, timeout...). Mapped to HTTP 503.
type DatabaseError struct{ Err error }

func (e *DatabaseError) Error() string { return "database unavailable: " + e.Err.Error() }
func (e *DatabaseError) Unwrap() error { return e.Err }

type Sale struct {
	TransactionID   string  `json:"transaction_id"`
	TransactionDate string  `json:"transaction_date"`
	Item            string  `json:"item"`
	Quantity        int     `json:"quantity"`
	PricePerUnit    float64 `json:"price_per_unit"`
	TotalSpent      float64 `json:"total_spent"`
	PaymentMethod   string  `json:"payment_method"`
	Location        string  `json:"location"`
}

type Group struct {
	Name         string  `json:"name"`
	Transactions int     `json:"transactions"`
	Units        int     `json:"units"`
	Revenue      float64 `json:"revenue"`
}

type Summary struct {
	TotalRevenue      float64 `json:"total_revenue"`
	TotalTransactions int     `json:"total_transactions"`
	TotalUnits        int     `json:"total_units"`
	AverageTicket     float64 `json:"average_ticket"`
	ByItem            []Group `json:"by_item"`
	ByPaymentMethod   []Group `json:"by_payment_method"`
	ByLocation        []Group `json:"by_location"`
	ByMonth           []Group `json:"by_month"`
}

// Filters: nil means "not provided"; a pointer to "" is a real (empty) filter, like in Python.
type Filters struct {
	DateFrom, DateTo, Item, PaymentMethod, Location *string
}

type Repository interface {
	ListSales(ctx context.Context, filters Filters, limit, offset int) ([]Sale, error)
	GetSale(ctx context.Context, transactionID string) (*Sale, error)
	Summary(ctx context.Context, dateFrom, dateTo *string) (*Summary, error)
}

const salesSelect = `
	SELECT s.transaction_id, s.transaction_date, i.name AS item, s.quantity,
	       s.price_per_unit, s.total_spent, p.name AS payment_method, l.name AS location`

const fromJoins = `
	FROM sales s
	JOIN items i USING (item_id)
	JOIN payment_methods p USING (payment_method_id)
	JOIN locations l USING (location_id)`

const metrics = `COUNT(*) AS transactions, COALESCE(SUM(s.quantity), 0) AS units,
	COALESCE(SUM(s.total_spent), 0) AS revenue`

// whereClause builds a parameterized WHERE clause (never concatenates user input).
func whereClause(f Filters) (string, []any) {
	conditions := []struct {
		sql   string
		value *string
	}{
		{"s.transaction_date >= ?", f.DateFrom},
		{"s.transaction_date <= ?", f.DateTo},
		{"i.name = ?", f.Item},
		{"p.name = ?", f.PaymentMethod},
		{"l.name = ?", f.Location},
	}
	var parts []string
	var args []any
	for _, c := range conditions {
		if c.value != nil {
			parts = append(parts, c.sql)
			args = append(args, *c.value)
		}
	}
	if len(parts) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args
}

type SQLRepository struct{ db *sql.DB }

func NewSQLRepository(db *sql.DB) *SQLRepository { return &SQLRepository{db: db} }

func (r *SQLRepository) querySales(ctx context.Context, query string, args ...any) ([]Sale, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, &DatabaseError{Err: err}
	}
	defer rows.Close()

	sales := make([]Sale, 0) // encode as [] (not null) when empty
	for rows.Next() {
		var s Sale
		if err := rows.Scan(&s.TransactionID, &s.TransactionDate, &s.Item, &s.Quantity,
			&s.PricePerUnit, &s.TotalSpent, &s.PaymentMethod, &s.Location); err != nil {
			return nil, &DatabaseError{Err: err}
		}
		sales = append(sales, s)
	}
	if err := rows.Err(); err != nil {
		return nil, &DatabaseError{Err: err}
	}
	return sales, nil
}

func (r *SQLRepository) ListSales(ctx context.Context, f Filters, limit, offset int) ([]Sale, error) {
	where, args := whereClause(f)
	query := salesSelect + fromJoins + where +
		" ORDER BY s.transaction_date, s.transaction_id LIMIT ? OFFSET ?"
	return r.querySales(ctx, query, append(args, limit, offset)...)
}

func (r *SQLRepository) GetSale(ctx context.Context, transactionID string) (*Sale, error) {
	sales, err := r.querySales(ctx, salesSelect+fromJoins+" WHERE s.transaction_id = ?", transactionID)
	if err != nil || len(sales) == 0 {
		return nil, err
	}
	return &sales[0], nil
}

func (r *SQLRepository) groups(ctx context.Context, expression, where string, args []any) ([]Group, error) {
	query := fmt.Sprintf("SELECT %s AS name, %s %s%s GROUP BY name ORDER BY name", expression, metrics, fromJoins, where)
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, &DatabaseError{Err: err}
	}
	defer rows.Close()

	groups := make([]Group, 0)
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.Name, &g.Transactions, &g.Units, &g.Revenue); err != nil {
			return nil, &DatabaseError{Err: err}
		}
		groups = append(groups, g)
	}
	if err := rows.Err(); err != nil {
		return nil, &DatabaseError{Err: err}
	}
	return groups, nil
}

func (r *SQLRepository) Summary(ctx context.Context, dateFrom, dateTo *string) (*Summary, error) {
	where, args := whereClause(Filters{DateFrom: dateFrom, DateTo: dateTo})

	var s Summary
	err := r.db.QueryRowContext(ctx, "SELECT "+metrics+fromJoins+where, args...).
		Scan(&s.TotalTransactions, &s.TotalUnits, &s.TotalRevenue)
	if err != nil {
		return nil, &DatabaseError{Err: err}
	}
	if s.TotalTransactions > 0 {
		s.AverageTicket = math.Round(s.TotalRevenue/float64(s.TotalTransactions)*100) / 100
	}

	targets := []struct {
		expression string
		dest       *[]Group
	}{
		{"i.name", &s.ByItem},
		{"p.name", &s.ByPaymentMethod},
		{"l.name", &s.ByLocation},
		{"DATE_FORMAT(s.transaction_date, '%Y-%m')", &s.ByMonth},
	}
	for _, t := range targets {
		g, err := r.groups(ctx, t.expression, where, args)
		if err != nil {
			return nil, err
		}
		*t.dest = g
	}
	return &s, nil
}

// Compile-time check that SQLRepository satisfies Repository.
var _ Repository = (*SQLRepository)(nil)
