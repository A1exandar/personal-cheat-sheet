+++
title = "Host One or Multiple Websites with Nginx on Ubuntu Server"
date = 2026-08-28
description = "Set up Nginx server blocks, PHP-FPM, MySQL, and WordPress for one or more websites on Ubuntu."
tags = ["nginx", "ubuntu", "web-server", "wordpress"]
+++

This guide uses Ubuntu because it is approachable for new users. The same general approach also works on other Linux server distributions.

> The original guide uses PHP 8.0 commands. Select a currently supported PHP version that is compatible with your Ubuntu release before using it on a new server.

## Update Ubuntu

```bash
sudo apt-get update && sudo apt-get dist-upgrade && sudo apt-get autoremove
```

## Install Nginx

Install Nginx and check that the service is running:

```bash
sudo apt-get install nginx
sudo systemctl status nginx
```

![Nginx service status](/images/nginx-status.png)

Then open `http://localhost` in a browser to confirm that Nginx is serving a page.

![Nginx in the browser](/images/nginx-browser.png)

## Install PHP and PHP modules

WordPress needs PHP and several PHP modules. The following commands reflect the original PHP 8.0 setup:

```bash
sudo apt-get install software-properties-common
sudo add-apt-repository ppa:ondrej/php
sudo apt update
sudo apt install php8.0-fpm php8.0-common php8.0-mysql php8.0-gmp php8.0-curl \
  php8.0-intl php8.0-mbstring php8.0-xmlrpc php8.0-gd php8.0-xml php8.0-cli php8.0-zip
sudo systemctl status php8.0-fpm
```

## Configure Nginx for PHP-FPM

Open the PHP-FPM pool configuration when you need to adjust its settings:

```bash
sudo nano /etc/php/8.0/fpm/pool.d/www.conf
```

![Nginx server block configuration](/images/nginx-server-block.png)

## Install and configure MySQL

Install MySQL, check the service, and secure the installation:

```bash
sudo apt install mysql-server
sudo systemctl status mysql
sudo mysql_secure_installation
```

Sign in to MySQL with the password you created:

```bash
sudo mysql -u root -p
```

Create a database and user for each website. Replace the example names and password with your own values:

```sql
CREATE USER 'alexandar'@'localhost' IDENTIFIED BY 'password';
CREATE DATABASE wpsite1db;
CREATE DATABASE wpsite2db;
GRANT ALL ON *.* TO 'username'@'localhost';
FLUSH PRIVILEGES;
exit;
```

You can create additional databases and users for additional sites.

## Create document roots

Each Nginx server block needs a matching `root` directory. Create one directory for each site:

```bash
sudo mkdir -p /var/www/site1.com
sudo mkdir -p /var/www/site2.com
```

Download and extract WordPress into each directory, or create an `index.html` file for a static site.

Assign the directories to your normal user account so that you can edit their contents without `sudo`:

```bash
sudo chown -R $USER:$USER /var/www/example.com/html
sudo chown -R $USER:$USER /var/www/test.com/html
sudo chmod -R 755 /var/www
```

Depending on the application, you may need to adjust ownership and permissions to let `www-data` write where necessary.

## Create Nginx server blocks

Create one Nginx configuration file per website. You can begin by copying the default configuration:

```bash
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/example1.com
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/example2.net
sudo nano /etc/nginx/sites-available/example.com
```

Use a server block like this for each website, changing the domain name and document root:

```nginx
server {
    listen 80;
    listen [::]:80;
    root /var/www/html/mysite.com;
    index index.php index.html index.htm;
    server_name mysite.com www.mysite.com;

    error_log /var/log/nginx/mysite.com_error.log;
    access_log /var/log/nginx/mysite.com_access.log;
    client_max_body_size 100M;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.0-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}
```

Repeat the process for every additional site.

## Enable the server blocks and reload Nginx

Enable each server block with a symbolic link:

```bash
sudo ln -s /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/test.com /etc/nginx/sites-enabled/
```

If your configuration has many server names, open the Nginx configuration:

```bash
sudo nano /etc/nginx/nginx.conf
```

Uncomment or add `server_names_hash_bucket_size` in the `http` block:

```nginx
http {
    server_names_hash_bucket_size 64;
}
```

Validate the configuration before reloading Nginx:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

## Install WordPress

Download WordPress and copy its contents into each document root:

```bash
cd /tmp
wget http://wordpress.org/latest.tar.gz
tar -xzvf latest.tar.gz
sudo cp -r wordpress/* /var/www/site1/
sudo cp -r wordpress/* /var/www/site2/
sudo cp -r wordpress/* /var/www/site3/
```

Set appropriate ownership and permissions, then prepare the WordPress configuration:

```bash
sudo chown -R www-data:www-data /var/www/site*
sudo chmod -R 775 /var/www/mysite.com
cd /var/www/mysite.com
sudo mv wp-config-sample.php wp-config.php
sudo nano wp-config.php
```

![WordPress database settings in wp-config.php](/images/wordpress-mysql-edits.png)

Add the database values and WordPress API keys to `wp-config.php`, then test and reload Nginx again:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

## Optional local host entries

For local testing, add the domain names to `/etc/hosts`:

```bash
sudo nano /etc/hosts
```

```text
127.0.0.1 localhost
203.0.113.5 example.com www.example.com
```
