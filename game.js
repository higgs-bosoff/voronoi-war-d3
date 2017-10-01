// Parameters
rScale = 1;
rMin = 0.5;
scoreRate = 1e-6;
damageRate = 0.15;
arrowSpread = 200;
arrowBase = 10;

//

function redrawPolygon(polygon) {
    polygon.attr("d", function(d) {
        return d ? "M" + d.join("L") + "Z" : null;
    });
}

function factionClass(d) {
    if (!d) return "";
    var f = d.data[2];
    return f === 0 ? "neutral" : f == 1 ? "friend" : "enemy";
}

function redrawUnit(unit) {
    unit
        .attr("cx", function(d) {
            return d.x;
        })
        .attr("cy", function(d) {
            return d.y;
        })
        .attr("r", function(d) {
            return d.radius();
        })
        .attr("class", function(d) {
            f = d.faction;
            return f === 0 ? "neutral" : f == 1 ? "friend" : "enemy";
        })
        .each(function(d) {
            d3.select(this).on("click", function(a, b, c, e) {
                if (d3.event.shiftKey) {
                    map.shiftSelect(d.i);
                } else {
                    map.select(d.i);
                }
            });
        });
}

function redrawEdge(edge) {
    edge.attr('x1', function(d) {
            return d ? d[0][0] : 0;
        })
        .attr('x2', function(d) {
            return d ? d[1][0] : 0;
        })
        .attr('y1', function(d) {
            return d ? d[0][1] : 0;
        })
        .attr('y2', function(d) {
            return d ? d[1][1] : 0;
        })
        .style('visibility', function(d) {
            return (d && d.left && d.right &&
                    d.left.data[2] + d.right.data[2] == 3) ?
                'visible' :
                'hidden';
        });
}

var WarNode = function(faction, attack, health, speed, x, y) {
    this.faction = faction;
    this.attack = attack;
    this.max_health = health;
    this.health = health;
    this.speed = speed;
    this.x = x;
    this.y = y;
    this.targ_x = x;
    this.targ_y = y;
    this.moving = false;
};

WarNode.prototype = {

    move: function(dt) {

        var dx = (this.targ_x - this.x);
        var dy = (this.targ_y - this.y);
        var l = Math.sqrt(dx * dx + dy * dy);

        var dl = this.speed * dt / (1000.0 * l);

        if (dl < 1) {
            dx *= dl;
            dy *= dl;

            this.x += dx;
            this.y += dy;
        } else {
            this.x = this.targ_x;
            this.y = this.targ_y;
            this.moving = false;
        }

    },

    moveTo: function(tx, ty) {
        this.targ_x = tx;
        this.targ_y = ty;
        this.moving = true;
    },

    radius: function() {
        return this.health* rScale + rMin;
    }

}

var WarMap = function(selector, targ_score, config) {
    this.svg = d3.select(selector);

    var vbox = this.svg.attr('viewBox').split(',');

    this.width = parseFloat(vbox[2]);
    this.height = parseFloat(vbox[3]);

    this.tscore = targ_score;

    // Conversion matrices  
    this.SVG2SCR = this.svg._groups[0][0].getScreenCTM();
    this.SCR2SVG = this.SVG2SCR.inverse();

    // Click capture system
    var self = this;
    this._lastbutton = -1;
    // 1. No context menu
    this.svg.on("contextmenu", function() {
        d3.event.preventDefault();
    });
    // 2. On mouse down, keep track of starting point and which button was pressed
    this.svg.on("mousedown", function() {
        self._pt0 = self.getMouseCoords();
        self._lastbutton = d3.event.button;

        switch (self._lastbutton) {
            case 0:
                self.selrect.classed('hidden', false)
                            .attr('x', self._pt0.x)
                            .attr('y', self._pt0.y)
                            .attr('width', 0)
                            .attr('height', 0);
                break;
            case 2:
                self.movearrow.classed('hidden', false);
                self.drawArrow(self._pt0, self._pt0);
                break;
        }        
    });
    // 3. On mouse move, change the graphic
    this.svg.on("mousemove", function() {
        var p = self.getMouseCoords();
        switch (self._lastbutton) {
            case 0:
                self.selrect.attr('x', Math.min(self._pt0.x, p.x))
                            .attr('y', Math.min(self._pt0.y, p.y))
                            .attr('width', Math.abs(p.x-self._pt0.x))
                            .attr('height', Math.abs(p.y-self._pt0.y));
                break;
            case 2:
                self.drawArrow(self._pt0, p);
                break;
        }
    });

    this.svg.on("mouseup mouseleave", function() {
        var p1 = self.getMouseCoords();

        switch(self._lastbutton) {
            case 0: 
                self.selrect.classed('hidden', true);
                self.areaSelect(self._pt0.x, self._pt0.y, p1.x, p1.y, d3.event.shiftKey);
                break;
            case 2:
                self.movearrow.classed('hidden', true);
                self.orderGroup(self._pt0, p1);
                break;
        }

        self._lastbutton = -1;

    });


    this.voronoi = d3.voronoi().extent([
        [0, 0],
        [this.width, this.height]
    ]);
    this.nodes = [];

    // Graphic elements
    this.polygons = this.svg.append("g").attr("class", "polygons");
    this.units = this.svg.append("g").attr("class", "units");
    this.edges = this.svg.append("g").attr("class", "edges");
    this.selcircles = this.svg.append("g").attr("class", "sel-circle");
    this.selrect = this.svg.append('rect')
                        .classed('sel-rect', true)
                        .classed('hidden', true)
                        .attr('x', 0)
                        .attr('y', 0)
                        .attr('width', 20)
                        .attr('height', 20);
    this.movearrow = this.svg.append('path')
                         .classed('move-arrow', true)
                         .classed('hidden', true);
    this.spawns = this.svg.append("g").attr("class", "spawn-area");    


    this.selection = [];

    // Running interval
    this.dt = 30;
    this.interval = null;

    // Scores
    this.scores = {
      1: 0.0,
      2: 0.0,
    };

    this.generate(config);

};

WarMap.prototype = {

    generate: function(config) {
        // Generate a map with n nodes for each faction

        // First, generate obstacles
        for (var i = 0; i < config.terrain.length; ++i) {
            var tn = config.terrain[i];
            this.addNode(new WarNode(0, 0, tn[2], 0, tn[0], tn[1]));
        }

        // Now spawn points
        this.spawns.selectAll("circle")
                   .data(config.spawns).enter()
                   .append("circle")
                   .attr('cx', function(d) { return d[0]; })
                   .attr('cy', function(d) { return d[1]; })
                   .attr('r', 15);

        // Find on which side of the border are the teams
        var b1 = config.border[0];
        var b2 = config.border[1];
        function bside(x, b) {
            return Math.sign((x[0]-b[0][0])*(b[1][1]-b[0][1]) - (x[1]-b[0][1])*(b[1][0]-b[0][0]));
        }
        var teamsides = [bside(config.spawns[0], b1), bside(config.spawns[1], b2)];
        /*
        if (teamsides[0] == teamsides[1]) {
            // WTF?
            throw 'Invalid config';
        }*/

        // Now spawn points!
        var n1 = 0;
        var n2 = 0;

        while((n1 < config.n1) || (n2 < config.n2)) {
            // Extract a random point
            var p = [Math.random()*this.width,
                     Math.random()*this.height];
            var s1 = bside(p, b1);
            var s2 = bside(p, b2);

            if (s1 == teamsides[0] && n1 < config.n1) {                
                this.addNode(new WarNode(1, config.stats[0][0],
                                            config.stats[0][1],
                                            config.stats[0][2], p[0], p[1]));
                n1 += 1;
                continue;
            }
            if (s2 == teamsides[1] && n2 < config.n2) {
                this.addNode(new WarNode(2, config.stats[0][0],
                                            config.stats[0][1],
                                            config.stats[0][2], p[0], p[1]));
                n2 += 1;
                continue;
            }
        }

    },

    getMouseCoords: function() {
        // Mouse coordinates in point format from last event
        var pt = this.svg._groups[0][0].createSVGPoint();
        pt.x = d3.event.clientX;
        pt.y = d3.event.clientY;
        return pt.matrixTransform(this.SCR2SVG);
    },

    drawArrow: function(p0, p1) {
        var dx = p1.x-p0.x;
        var dy = p1.y-p0.y;
        var l = Math.sqrt(dx*dx+dy*dy);
        var ang = Math.atan2(dy, dx)*180/Math.PI;
        // Point from pt0 to p1
        this.movearrow.attr('d', 
                            'M '+p0.x+','+(p0.y-arrowSpread/(arrowBase+l))+' '+
                            'L '+(p0.x+l)+','+p0.y+' '+
                            'L '+p0.x+','+(p0.y+arrowSpread/(arrowBase+l)))
                      .attr('transform', 
                            'rotate('+ang+','+p0.x+','+p0.y+')');
    },

    addNode: function(n) {
        n.i = this.nodes.length;
        this.nodes.push(n);
    },

    removeNode: function(i) {
        // Keep selection
        var sel = this.selection;
        this.nodes.splice(i, 1);
        this.indexNodes();
        // Now, do we need to update anything?
        if (this.selection.includes(i)) {
            this.selection.splice(this.selection.indexOf(i), 1);
        }

        for (var j = 0; j < this.selection.length; ++j) {
            if (this.selection[j] > i) {
                this.selection[j] -= 1;
            }
        }
    },

    indexNodes: function() {
        this.nodes = this.nodes.map(function(d, i) {
            d.i = i;
            return d;
        });
    },

    recalc: function() {
        this._points = this.nodes
            .map(function(d) {
                return [d.x, d.y, d.faction, d.i];
            })
            .sort(function(a, b) {
                return a[2] > b[2];
            });
        this._diagram = this.voronoi(this._points);
        this._cells = this._diagram.polygons(this._points);
        this._links = this._diagram.links(this._points);
    },

    redraw: function() {
        var polys = this.polygons.selectAll("path").data(this._cells);
        polys
            .enter()
            .append("path")
            .attr("class", factionClass)
            .call(redrawPolygon);
        polys.attr("class", factionClass).call(redrawPolygon);
        polys.exit().remove();

        var uns = this.units.selectAll("circle").data(this.nodes);
        uns.enter().append("circle").call(redrawUnit);
        uns.call(redrawUnit);
        uns.exit().remove();

        var edges = this.edges.selectAll("line").data(this._diagram.edges);
        edges.enter().append("line").call(redrawEdge);
        edges.call(redrawEdge);
        edges.exit().remove();

        this.redrawSel();
    },

    redrawSel: function() {
        var circles = this.selcircles.selectAll("circle").data(this.selection);
        nodes = this.nodes;
        circles
            .enter()
            .append("circle")
            .attr("r", 3)
            .attr("cx", function(d) {
                return nodes[d].x;
            })
            .attr("cy", function(d) {
                return nodes[d].y;
            });
        circles
            .attr("cx", function(d) {
                return nodes[d].x;
            })
            .attr("cy", function(d) {
                return nodes[d].y;
            });
        circles.exit().remove();
    },

    moveAll: function() {
      for (var i = 0; i < this.nodes.length; ++i) {
          var n = this.nodes[i];
          if (n.moving) {
              n.move(this.dt);
          }
      }      
    },

    solveCollisions: function() {
      for (var i = 0; i < this._links.length; ++i) {
          var p1 = this._links[i].source;
          var p2 = this._links[i].target;
          var n1 = this.nodes[p1[3]];
          var n2 = this.nodes[p2[3]];

          // Check radii
          var rmin = n1.radius()+n2.radius();
          // Distance? 
          var dx = p2[0]-p1[0];
          var dy = p2[1]-p1[1];
          var l = Math.sqrt(dx*dx+dy*dy);
          if (l < rmin) {
            // Collision!
            // Move away the first one that counts as moving
            if (n1.moving) {
              n1.x -= dx/l*(rmin-l);
              n1.y -= dy/l*(rmin-l);
            }
            else {
              n2.x += dx/l*(rmin-l);
              n2.y += dy/l*(rmin-l);                
            }
          }
      }

      // Now borders
      for (var i = 0; i < this.nodes.length; ++i) {
        var n = this.nodes[i];
        n.x = n.x < 0? 0 : (n.x > this.width? this.width : n.x);
        n.y = n.y < 0? 0 : (n.y > this.height? this.height : n.y);
      }
    },

    resolveBattles: function() {
      var to_remove = [];
      for (var i = 0; i < this._diagram.edges.length; ++i) {
        var e = this._diagram.edges[i];
        if (e && e.left && e.right && e.left.data[2]+e.right.data[2] == 3) {
          var il = e.left.data[3];
          var ir = e.right.data[3];
          if (to_remove.indexOf(il) >= 0 || to_remove.indexOf(ir) >= 0)
            continue;
          var dx = e[1][0]-e[0][0];
          var dy = e[1][1]-e[0][1];
          var l = Math.sqrt(dx*dx+dy*dy);
          var dmg = l*this.dt/1000*damageRate;
          this.nodes[il].health -= this.nodes[ir].attack*dmg;
          this.nodes[ir].health -= this.nodes[il].attack*dmg;          
          if (this.nodes[il].health <= 0) 
            to_remove.push(il);
          if (this.nodes[ir].health <= 0) 
            to_remove.push(ir);          
        }
      }

      // Remove any nodes with zero health
      to_remove.sort();
      for (var i = to_remove.length-1; i >= 0; --i) {
        this.removeNode(to_remove[i]);
      }
    },

    calcScore: function() {
      for (var i = 0; i < this._cells.length; ++i) {
        var c = this._cells[i];        
        if (!c || c.data[2] == 0) // Neutral
          continue;
        var area = 0;
        var cx = c.data[0];
        var cy = c.data[1];
        var v0x = c[0][0]-cx;
        var v0y = c[0][1]-cy;
        var v1x;
        var v1y;
        for (var j = 1; j < c.length; ++j) {
          v1x = c[j][0]-cx;
          v1y = c[j][1]-cy;
          area += Math.abs((v1x*v0y-v0x*v1y)/2);
          v0x = v1x;
          v0y = v1y;
        }

        this.scores[c.data[2]] += area*this.dt*scoreRate;
      }

      d3.select('#score1').html(Math.ceil(this.scores[1]/this.tscore*100.0) + '%');
      d3.select('#score2').html(Math.ceil(this.scores[2]/this.tscore*100.0) + '%');

      if (this.scores[1] >= this.tscore) {
        return 1;        
      }
      else if (this.scores[2] >= this.tscore) {
        return 2;
      }

      return 0;

    },

    update: function() {

        // Redraw
        this.redraw();
        // Moving
        this.moveAll();
        // Recalculate with new positions
        this.recalc();
        // Check for collisions
        this.solveCollisions();
        // Damage calculation
        this.resolveBattles();
        // Calculate scores & check for victory
        var win = this.calcScore();

        if (win > 0) {
            this.stop();
            alert('Team ' + win + ' wins!');
        }
    },

    select: function(i) {
        if (i < 0 || i >= this.nodes.length || this.nodes[i].faction != 1)
            this.selection = [];
        else this.selection = [i];

        this.redrawSel();
    },

    shiftSelect: function(i) {
        if (i < 0 || i >= this.nodes.length || this.nodes[i].faction != 1) return;
        if (this.selection.includes(i)) {
            var j = this.selection.indexOf(i);
            this.selection.splice(j, 1);
        } else {
            this.selection.push(i);
        }

        this.redrawSel();
    },

    areaSelect: function(x1, y1, x2, y2, add) {
        if (!add)
            this.selection = [];
        var xmin = Math.min(x1, x2);
        var xmax = Math.max(x1, x2);
        var ymin = Math.min(y1, y2);
        var ymax = Math.max(y1, y2);

        for (var i = 0; i < this.nodes.length; ++i) {
            var n = this.nodes[i];            
            if (n.x >= xmin && n.x < xmax &&
                n.y >= ymin && n.y < ymax &&
                n.faction == 1 && 
                (!add || this.selection.indexOf(i) < 0)) {
                this.selection.push(i);
            }
        }

        this.redrawSel();
    },

    orderGroup: function(p0, p1) {
        var dx = p1.x-p0.x;
        var dy = p1.y-p0.y;
        var l = Math.sqrt(dx*dx+dy*dy);
        var ang = Math.atan2(dy, dx)*180/Math.PI;

        var tlen = this.selection.length-1.0;
        var w = arrowSpread/(arrowBase+l);
        var pl = [p0.x-dy/l*w, p0.y+dx/l*w];
        var pr = [p0.x+dy/l*w, p0.y-dx/l*w];
        var pu = [p1.x, p1.y];

        for (var i = 0; i < this.selection.length; ++i) {
            var tx, ty;
            if (l > 0 && tlen > 0) {
                var t = i/tlen;
                if (t < 0.5) {
                    t = t/0.5;
                    tx = pl[0]*(1-t)+pu[0]*t;
                    ty = pl[1]*(1-t)+pu[1]*t;
                }
                else {
                    t = (t-0.5)/0.5;
                    tx = pu[0]*(1-t)+pr[0]*t;
                    ty = pu[1]*(1-t)+pr[1]*t;
                }                
            }
            else {
                tx = p1.x;
                ty = p1.y;
            }

            this.nodes[this.selection[i]].moveTo(tx, ty);
        }
    },

    run: function(dt) {
        // Run with given dt
        this.dt = dt || this.dt;
        this.recalc();

        this.interval = setInterval((function(self) {
            return function() {
                self.update();
            };
        })(this), this.dt);
    },

    stop: function() {
        clearInterval(this.interval);
    }
};

// Test level
testmap = {
    terrain: [
        [10, 50, 1],
        [30, 50, 2],
        [50, 50, 3],
        [70, 50, 2],
        [90, 50, 1],
    ],
    spawns: [
        [50, 10],
        [50, 90]
    ], 
    border: [
        [[0, 40],
         [100, 40]],
        [[0, 60],
         [100, 60]],         
    ],
    stats: [    // Attack, health, speed
        [2, 1, 5],
        [1, 2, 3]
    ],
    n1: 10,
    n2: 20,
};

var PlayerController = function(map) {
    // Handles the controls on the player's side
    
}

var map = new WarMap("#field", 100, testmap);

// Generate points
points = [];

function randint(n) {
    return Math.floor(Math.random() * n);
}

/*
for (var i = 0; i < 40; ++i) {
    points.push([randint(100), randint(100)]);
}
for (var i = 0; i < 30; ++i) {
  points.push([randint(100), randint(50)]);
}
for (var i = 0; i < points.length; ++i) {
    map.addNode(
        new WarNode(i > 0 ? randint(3) : 1, 0.02, 1, 30, points[i][0], points[i][1])
    );
}*/




//map.select(0);

d3.select('body').on('keypress', function() {
    if (d3.event.key == 'q') {
        map.removeNode(0);
        map.update();
    }
})

map.run(20);