#include <QApplication>
#include <QAction>
#include <QSettings>
#include <QImage>
#include <QTimer>
#include <QTableView>
#include <QTemporaryDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QAbstractItemModel>
#include <iostream>
#include <stdexcept>
#include "MainWindow.h"
#include "MetaObjectRegistry.h"
#include "LayerListModel.h"
using namespace mmp;
static void check(bool pass, const char *what) {
  if (!pass) throw std::runtime_error(what);
  std::cout << "PASS " << what << std::endl;
}
int main(int argc, char **argv) {
  auto &registry=MetaObjectRegistry::instance();
  registry.add<Image>(); registry.add<Video>(); registry.add<Color>();
  registry.add<TextureLayer>(); registry.add<ColorLayer>();
  registry.add<Mesh>(); registry.add<Quad>(); registry.add<Triangle>(); registry.add<mmp::Ellipse>();
  QApplication app(argc, argv);
  app.setOrganizationName("MapMapSourceSwitchRegression");
  app.setOrganizationDomain("mapmap-regression.invalid");
  app.setApplicationName("SourceSwitchTests");
  QSettings s;
  s.setValue("displayOutputWindow", false);
  s.setValue("displayTestSignal", false);
  s.setValue("mcpListeningPort", 0);
  s.setValue("oscListeningPort", 12347);
  try {
    QTemporaryDir fixtures;
    QStringList files;
    if (argc == 4) {
      files << argv[1] << argv[2] << argv[3];
    } else {
      check(argc == 1 && fixtures.isValid(), "create isolated test fixtures");
      const QString grid=fixtures.filePath("grid.png");
      const QString png=fixtures.filePath("replacement.png");
      const QString jpg=fixtures.filePath("replacement.jpg");
      QImage a(1920,1080,QImage::Format_RGB32); a.fill(Qt::white);
      QImage b(2048,1035,QImage::Format_RGB32); b.fill(Qt::green);
      check(a.save(grid) && b.save(png) && b.save(jpg), "write PNG and JPEG fixtures");
      const QByteArray fixture=R"({"version":"1.0.0-alpha.1","sources":[{"className":"Image","id":1,"name":"Grid","uri":"","x":0,"y":0}],"layers":[{"className":"TextureLayer","id":1,"sourceId":1,"name":"Calibrated layer","source":{"className":"Mesh","nColumns":"2","nRows":"2","vertices":[[0,0],[1920,0],[0,1080],[1920,1080]]},"destination":{"className":"Mesh","nColumns":"2","nRows":"2","vertices":[[10,20],[1900,40],[40,1040],[1880,1050]]}}]})";
      auto project=QJsonDocument::fromJson(fixture).object();
      auto sources=project["sources"].toArray(); auto source=sources[0].toObject();
      source["uri"]=grid; sources[0]=source; project["sources"]=sources;
      QFile f(fixtures.filePath("calibration.mmp")); check(f.open(QIODevice::WriteOnly), "write calibration fixture");
      f.write(QJsonDocument(project).toJson()); f.close();
      files << f.fileName() << png << jpg;
    }
    MainWindow *win = MainWindow::window();
    check(win->loadFile(files[0]), "load calibration project");
    auto layer = win->getMappingManager().getLayerById(1);
    check(bool(layer), "calibrated layer exists");
    QVector<QPointF> original;
    for (int i=0;i<layer->getShape()->nVertices();++i) original << layer->getShape()->getVertex(i);
    auto *table=win->findChild<QTableView*>();
    check(table!=nullptr, "layer table exists");
    win->removeCurrentLayer();
    table->setCurrentIndex(table->model()->index(0,1));
    check(win->getCurrentLayer()==layer, "reselecting the same row restores the active layer");
    const uid grid = layer->getSourceId();
    QList<uid> ids;
    for (int j=1;j<3;++j) {
      check(!QImage(files[j]).isNull(), "Qt decodes original image file");
      check(win->importMediaFile(files[j], true, false), "import image into media library");
      ids << win->getCurrentSourceId();
    }
    auto trigger = [&](uid id) {
      QAction action(win); action.setData(id);
      QObject::connect(&action, SIGNAL(triggered(bool)), win, SLOT(loadLayerMedia()));
      action.trigger();
    };
    for (uid id : {ids[0], grid, ids[1], grid, ids[0]}) {
      win->setCurrentLayer(1);
      win->removeCurrentLayer(); // Library selection clears the active layer.
      check(!win->getCurrentLayer(), "reproduce missing active layer before Change media");
      trigger(id);
      check(layer->getSourceId()==id, "Change media succeeds after library selection");
      auto texture=qSharedPointerDynamicCast<Texture>(layer->getSource());
      const QRectF rect=texture->getRect();
      const QVector<QPointF> expected{rect.topLeft(),rect.topRight(),rect.bottomLeft(),rect.bottomRight()};
      for(int i=0;i<4;++i) {
        check(QLineF(layer->getInputShape()->getVertex(i),expected[i]).length()<0.001,
              "input covers complete image despite size and editor-position changes");
        check(layer->getShape()->getVertex(i)==original[i], "output calibration vertex unchanged");
      }
    }
    // Cropped images retain their normalized crop, instead of being reset to full frame.
    auto tex=qSharedPointerDynamicCast<Texture>(layer->getSource());
    const auto r=tex->getRect();
    layer->getInputShape()->setVertex(0,r.x()+r.width()*.25,r.y()+r.height()*.3);
    trigger(grid);
    auto to=qSharedPointerDynamicCast<Texture>(layer->getSource())->getRect();
    check(QLineF(layer->getInputShape()->getVertex(0),QPointF(to.x()+to.width()*.25,to.y()+to.height()*.3)).length()<.001,"normalized crop preserved");
    LayerListModel model;
    check(model.getItemId(QModelIndex())==NULL_UID,"empty list context lookup safe");
    check(!model.getIndexFromRow(-1).isValid(),"negative row produces invalid index");
    model.addItem(layer,QIcon(),"test");model.updateModel();
    const auto index=model.index(0,0);
    check(model.rowCount(index)==0 && model.columnCount(index)==0,"table cells have no child rows or columns");
    model.clear();
    check(model.getItemId(index)==NULL_UID && !model.data(index,Qt::DisplayRole).isValid(),"stale row lookup safe after clear");
    win->clearProject();
    trigger(ids[0]);
    check(win->getMappingManager().nLayers()==0,"Change media without a layer is a safe no-op");
    std::cout << "All source-switch regressions passed" << std::endl;
    return 0;
  } catch(const std::exception &e) {std::cerr << "FAIL " << e.what() << std::endl;return 1;}
}
