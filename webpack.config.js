const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { ModuleFederationPlugin } = webpack.container;
const packageJson = require("./package.json");

module.exports = (env, argv) => {
  const isProduction = argv.mode === "production";

  return {
    entry: "./src/index",
    output: {
      path: path.resolve(__dirname, "public")
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
        },
        {
          test: /\.(png|jpg|gif|svg)$/,
          type: "asset/resource"
        }
      ]
    },
    plugins: [
      new ModuleFederationPlugin({
        name: "SignalK Data Connector",
        library: {
          type: "var",
          name: packageJson.name.replace(/[-@/]/g, "_")
        },
        filename: "remoteEntry.js",
        exposes: {
          "./PluginConfigurationPanel": "./src/components/PluginConfigurationPanel"
        },
        shared: {
          react: {
            singleton: false,
            strictVersion: true
          },
          "react-dom": {
            singleton: false,
            strictVersion: true
          }
        }
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
