package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

var testSale = Sale{
	TransactionID:   "TXN_1",
	TransactionDate: "2023-01-01",
	Item:            "Coffee",
	Quantity:        2,
	PricePerUnit:    2.0,
	TotalSpent:      4.0,
	PaymentMethod:   "Cash",
	Location:        "In-store",
}

type listCall struct {
	filters       Filters
	limit, offset int
}

type fakeRepository struct {
	listCalls    []listCall
	summaryCalls [][2]*string
	err          error
}

func (f *fakeRepository) ListSales(_ context.Context, filters Filters, limit, offset int) ([]Sale, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.listCalls = append(f.listCalls, listCall{filters, limit, offset})
	return []Sale{testSale}, nil
}

func (f *fakeRepository) GetSale(_ context.Context, id string) (*Sale, error) {
	if id == "TXN_1" {
		return &testSale, nil
	}
	return nil, nil
}

func (f *fakeRepository) Summary(_ context.Context, dateFrom, dateTo *string) (*Summary, error) {
	f.summaryCalls = append(f.summaryCalls, [2]*string{dateFrom, dateTo})
	return &Summary{TotalRevenue: 4, TotalTransactions: 1}, nil
}

func get(t *testing.T, repo Repository, target string) (int, map[string]any, []any) {
	t.Helper()
	rec := httptest.NewRecorder()
	NewServer(repo).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	var body any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON %q: %v", rec.Body.String(), err)
	}
	object, _ := body.(map[string]any)
	list, _ := body.([]any)
	return rec.Code, object, list
}

func deref(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func TestListSalesReturnsRowsAndForwardsFilters(t *testing.T) {
	repo := &fakeRepository{}
	code, _, list := get(t, repo, "/sales?date_from=2023-01-01&item=Coffee&limit=50&offset=10")
	if code != 200 || len(list) != 1 {
		t.Fatalf("got %d %v", code, list)
	}
	call := repo.listCalls[0]
	if deref(call.filters.DateFrom) != "2023-01-01" || deref(call.filters.Item) != "Coffee" || call.limit != 50 || call.offset != 10 {
		t.Fatalf("unexpected call %+v", call)
	}
}

func TestDefaultsAreLimit100AndOffset0(t *testing.T) {
	repo := &fakeRepository{}
	get(t, repo, "/sales")
	if call := repo.listCalls[0]; call.limit != 100 || call.offset != 0 {
		t.Fatalf("unexpected call %+v", call)
	}
}

func TestInvalidQueryReturns422(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=10001", "limit=abc", "offset=-1", "date_from=ayer", "date_to=2023-02-30"} {
		repo := &fakeRepository{}
		if code, _, _ := get(t, repo, "/sales?"+query); code != 422 || len(repo.listCalls) != 0 {
			t.Errorf("%s: got %d, calls %d", query, code, len(repo.listCalls))
		}
	}
}

func TestDateFromAfterDateToReturns422(t *testing.T) {
	code, body, _ := get(t, &fakeRepository{}, "/sales?date_from=2023-12-01&date_to=2023-01-01")
	want := map[string]any{"detail": "date_from must be on or before date_to"}
	if code != 422 || !reflect.DeepEqual(body, want) {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestGetSaleFound(t *testing.T) {
	code, body, _ := get(t, &fakeRepository{}, "/sales/TXN_1")
	if code != 200 || body["transaction_date"] != "2023-01-01" || body["transaction_id"] != "TXN_1" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestGetSaleMissingReturns404(t *testing.T) {
	code, body, _ := get(t, &fakeRepository{}, "/sales/TXN_999")
	want := map[string]any{"detail": "Sale TXN_999 not found"}
	if code != 404 || !reflect.DeepEqual(body, want) {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestSummaryForwardsDateRange(t *testing.T) {
	repo := &fakeRepository{}
	code, _, _ := get(t, repo, "/summary?date_to=2023-06-30")
	call := repo.summaryCalls[0]
	if code != 200 || call[0] != nil || deref(call[1]) != "2023-06-30" {
		t.Fatalf("got %d %v", code, call)
	}
}

func TestDatabaseErrorReturns503(t *testing.T) {
	repo := &fakeRepository{err: &DatabaseError{Err: errors.New("connection refused")}}
	code, body, _ := get(t, repo, "/sales")
	want := map[string]any{"detail": "Database unavailable"}
	if code != 503 || !reflect.DeepEqual(body, want) {
		t.Fatalf("got %d %v", code, body)
	}
}
