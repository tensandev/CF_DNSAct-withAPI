<?php
require '../vendor/autoload.php';
require './sql_connect.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

$host = $_ENV['DB_HOST'];
$dbname = (int)$_ENV['DB_DATADASE'];
$port = $_ENV['DB_PORT'];
$user = $_ENV['DB_USERNAME'];
$password = $_ENV['DB_PASSWORD'];

try {
    $dsn = 'mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4';

    $pdo = new PDO($dsn, $user, $password);

    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    header('Location: /error/insider_connect_error.php');
    exit;
}
