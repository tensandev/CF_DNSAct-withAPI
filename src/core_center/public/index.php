<?php
require '../config/autoload.php';

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
    <title></title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>

</html>
