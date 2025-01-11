<?php
require '../../config/autoload.php';

?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <?php
    if($_ENV['ROBOTS_NOINDEX']='true'){
        echo ('<meta name="robots" content="noindex">');
    }

    if($_ENV['ROBOTS_NOFOLLOW']='true'){
        echo ('<meta name="robots" content="nofollow">');
    }
    ?>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Cloudflare DNS Active API">
    <meta name="author" content="<?php echo $_ENV['AUTHOR']; ?>">
    <title>500 - 内部の接続不可によるエラー</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">

    <div class="min-h-screen flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div class="text-center">
            <h1 class="text-8xl font-extrabold text-red-600">
                500
            </h1>
            <h2 class="mt-2 text-4xl font-medium text-gray-700">
                内部の接続不可によるエラー
            </h2>
            <p class="mt-4 text-lg text-gray-500">
                申し訳ございませんが、システムに問題が発生しました。<br>
                開発チームが解決に向けて対応中です。しばらくお待ちください。
            </p>

            <div class="mt-4 text-sm text-gray-400">
                <p>システムの復旧までお待ちください。管理者に連絡する場合はエラーログをご確認ください。</p>
            </div>
        </div>
    </div>

</body>
</html>
