const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { ModuleFederationPlugin } = webpack.container;
const packageJson = require("./package.json");

const mfName = packageJson.name.replace(/[-@/]/g, "_");

module.exports = (env, argv) => {
  const isProduction = argv.mode === "production";

  return {
    entry: "./src/index.js",

    mode: isProduction ? "production" : "development",

    output: {
      path: path.resolve(__dirname, "public"),
      filename: isProduction ? "[name].[contenthash].js" : "[name].js",
      clean: true,
      publicPath: "auto"
    },

    module: {
      rules: [
        {
          test: /\.jsx?$/,
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
          use: [
            isProduction ? MiniCssExtractPlugin.loader : "style-loader",
            "css-loader"
          ]
        },
        {
          test: /\.(png|jpg|gif|svg)$/,
          type: "asset/resource"
        }
      ]
    },

    plugins: [
      new ModuleFederationPlugin({
        name: mfName,
        library: {
          type: "var",
          name: mfName
        },
        filename: "remoteEntry.js",
        exposes: {
          "./PluginConfigurationPanel": "./src/components/PluginConfigurationPanel"
        },
        shared: {
          react: { singleton: false, strictVersion: true },
          "react-dom": { singleton: false, strictVersion: true }
        }
      }),

      new webpack.WatchIgnorePlugin({
        paths: [path.resolve(__dirname, "public/")]
      }),

      new HtmlWebpackPlugin({
        template: "./src/webapp/index.html",
        filename: "index.html",
        title: "SignalK Data Connector Configuration"
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
