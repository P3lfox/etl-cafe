-- Normalized schema for the cafe sales data mart (MariaDB / MySQL).
-- Lookup tables hold each distinct value once; `sales` references them by FK.

CREATE TABLE IF NOT EXISTS items (
    item_id     TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50)   NOT NULL UNIQUE,
    menu_price  DECIMAL(6, 2) NOT NULL CHECK (menu_price > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS payment_methods (
    payment_method_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(50) NOT NULL UNIQUE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS locations (
    location_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
    transaction_id    VARCHAR(20)       PRIMARY KEY,
    transaction_date  DATE              NOT NULL,
    item_id           TINYINT UNSIGNED  NOT NULL,
    quantity          SMALLINT UNSIGNED NOT NULL CHECK (quantity > 0),
    price_per_unit    DECIMAL(6, 2)     NOT NULL CHECK (price_per_unit > 0),
    total_spent       DECIMAL(8, 2)     NOT NULL CHECK (total_spent > 0),
    payment_method_id TINYINT UNSIGNED  NOT NULL,
    location_id       TINYINT UNSIGNED  NOT NULL,
    INDEX idx_sales_date (transaction_date),
    CONSTRAINT fk_sales_item     FOREIGN KEY (item_id)           REFERENCES items (item_id),
    CONSTRAINT fk_sales_payment  FOREIGN KEY (payment_method_id) REFERENCES payment_methods (payment_method_id),
    CONSTRAINT fk_sales_location FOREIGN KEY (location_id)       REFERENCES locations (location_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
