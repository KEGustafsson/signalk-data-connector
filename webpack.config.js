const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const isProduction = argv.mode === "production";

  return {
    entry: {
      main: "./src/webapp/index.js",
      configPanel: "./src/components/configPanel.js"
    },
    output: {
      path: path.resolve(__dirname, "public"),
      filename: isProduction ? "[name].[contenthash].js" : "[name].js",
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: ["@babel/preset-env", "@babel/preset-react"]
            }
          }
        },
        {
          test: /\.css$/,
          use: [isProduction ? MiniCssExtractPlugin.loader : "style-loader", "css-loader"]
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./src/webapp/index.html",
        filename: "index.html",
        title: "SignalK Data Connector Configuration",
        chunks: ["main"]
      }),
      new HtmlWebpackPlugin({
        template: "./src/components/config.html",
        filename: "config.html",
        title: "SignalK Data Connector - Plugin Configuration",
        chunks: ["configPanel"]
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "src/webapp/icons"),
            to: path.resolve(__dirname, "public/icons"),
            noErrorOnMissing: true
          }
        ]
      }),
      ...(isProduction
        ? [
          new MiniCssExtractPlugin({
            filename: "[name].[contenthash].css"
          })
        ]
        : [])
    ],
    devtool: isProduction ? "source-map" : "eval-source-map",
    resolve: {
      extensions: [".js", ".jsx", ".json"]
    }
  };
};
